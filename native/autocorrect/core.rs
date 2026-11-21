//! Bounded, one/two-edit spell lookup for the vault's typing helper.
//! No external crates. All host input is read through the owned input buffer;
//! the ABI never dereferences a caller-provided pointer.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

const MAX_WORDS: usize = 90_000;
const MAX_WORD_LEN: usize = 32;
const INPUT_CAPACITY: usize = 256;
const PREFIX_LEN: usize = 7;
const BUCKET_COUNT: usize = 1 << 20;
const SIGNATURES_PER_WORD: usize = 1 + PREFIX_LEN + PREFIX_LEN * (PREFIX_LEN - 1) / 2;
const MAX_SIGNATURES: usize = MAX_WORDS * SIGNATURES_PER_WORD;

struct Word {
    text: Rc<str>,
    frequency: f64,
}

struct Signature {
    hash: u32,
    word: u32,
    next: u32,
}

struct Engine {
    input: Box<[u8; INPUT_CAPACITY]>,
    words: Vec<Word>,
    exact: HashMap<Rc<str>, u32>,
    buckets: Vec<u32>,
    signatures: Vec<Signature>,
    seen: Vec<u32>,
    epoch: u32,
    ready: bool,
    best: i32,
    second: i32,
    matches: u32,
    examined: u32,
    distance: i32,
    error: i32,
}

impl Engine {
    fn new() -> Self {
        Self {
            input: Box::new([0; INPUT_CAPACITY]),
            words: Vec::with_capacity(MAX_WORDS),
            exact: HashMap::with_capacity(MAX_WORDS),
            buckets: vec![0; BUCKET_COUNT],
            signatures: Vec::with_capacity(MAX_SIGNATURES),
            seen: Vec::with_capacity(MAX_WORDS),
            epoch: 0,
            ready: false,
            best: -1,
            second: -1,
            matches: 0,
            examined: 0,
            distance: -1,
            error: 0,
        }
    }

    fn clear_result(&mut self) {
        self.best = -1;
        self.second = -1;
        self.matches = 0;
        self.examined = 0;
        self.distance = -1;
        self.error = 0;
    }

    fn reset(&mut self) {
        self.words.clear();
        self.exact.clear();
        self.signatures.clear();
        self.seen.clear();
        self.buckets.fill(0);
        self.input.fill(0);
        self.epoch = 0;
        self.ready = false;
        self.clear_result();
    }

    fn read_input<'a>(&self, pointer: u32, length: u32, output: &'a mut [u8; MAX_WORD_LEN]) -> Option<&'a str> {
        let length = length as usize;
        if pointer != self.input.as_ptr() as u32 || length == 0 || length > MAX_WORD_LEN {
            return None;
        }
        for (index, byte) in self.input[..length].iter().enumerate() {
            let byte = byte.to_ascii_lowercase();
            if !byte.is_ascii_lowercase() && byte != b'\'' && byte != b'-' {
                return None;
            }
            output[index] = byte;
        }
        std::str::from_utf8(&output[..length]).ok()
    }

    fn add(&mut self, text: &str, frequency: f64) -> i32 {
        if !frequency.is_finite() || frequency < 0.0 {
            self.error = -1;
            return -1;
        }
        if let Some(&id) = self.exact.get(text) {
            let word = &mut self.words[id as usize];
            if frequency > word.frequency { word.frequency = frequency; }
            self.error = 0;
            return id as i32;
        }
        if self.words.len() >= MAX_WORDS {
            self.error = -2;
            return -2;
        }
        let id = self.words.len() as u32;
        let owned: Rc<str> = Rc::from(text);
        self.exact.insert(Rc::clone(&owned), id);
        self.words.push(Word { text: owned, frequency });
        self.seen.push(0);
        self.ready = false;
        self.error = 0;
        id as i32
    }

    fn build(&mut self) -> i32 {
        self.ready = false;
        self.signatures.clear();
        self.buckets.fill(0);
        for id in 0..self.words.len() {
            let (hashes, count) = signature_hashes(self.words[id].text.as_bytes(), 2);
            for &hash in &hashes[..count] {
                if self.signatures.len() >= MAX_SIGNATURES {
                    self.error = -2;
                    return -2;
                }
                let bucket = hash as usize & (BUCKET_COUNT - 1);
                let next = self.buckets[bucket];
                self.signatures.push(Signature { hash, word: id as u32, next });
                self.buckets[bucket] = self.signatures.len() as u32;
            }
        }
        self.ready = true;
        self.error = 0;
        self.signatures.len() as i32
    }

    fn better(&self, candidate: i32, previous: i32) -> bool {
        if previous < 0 { return true; }
        let candidate = &self.words[candidate as usize];
        let previous = &self.words[previous as usize];
        candidate.frequency > previous.frequency ||
            (candidate.frequency == previous.frequency && candidate.text < previous.text)
    }

    fn lookup(&mut self, text: &str, limit: usize) -> i32 {
        self.clear_result();
        if self.exact.contains_key(text) {
            self.distance = 0;
            return -1;
        }
        if !self.ready {
            self.error = -3;
            return -1;
        }
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.seen.fill(0);
            self.epoch = 1;
        }
        let (hashes, count) = signature_hashes(text.as_bytes(), limit);
        for &hash in &hashes[..count] {
            let mut entry = self.buckets[hash as usize & (BUCKET_COUNT - 1)];
            while entry != 0 {
                let signature = &self.signatures[(entry - 1) as usize];
                let id = signature.word as usize;
                entry = signature.next;
                if signature.hash != hash || self.seen[id] == self.epoch { continue; }
                self.seen[id] = self.epoch;
                self.examined += 1;
                let verification_limit = if self.distance == 1 { 1 } else { limit };
                let distance = if verification_limit == 1 {
                    if one_edit(text.as_bytes(), self.words[id].text.as_bytes()) { 1 } else { 2 }
                } else {
                    bounded_distance(text.as_bytes(), self.words[id].text.as_bytes(), limit)
                };
                if distance == 0 || distance > limit { continue; }
                if self.distance < 0 || distance < self.distance as usize {
                    self.best = -1;
                    self.second = -1;
                    self.matches = 0;
                    self.distance = distance as i32;
                }
                if distance != self.distance as usize { continue; }
                self.matches += 1;
                let id = id as i32;
                if self.better(id, self.best) {
                    self.second = self.best;
                    self.best = id;
                } else if self.better(id, self.second) {
                    self.second = id;
                }
            }
        }
        self.best
    }

    fn frequency(&self, id: i32) -> f64 {
        if id < 0 { return 0.0; }
        self.words.get(id as usize).map_or(0.0, |word| word.frequency)
    }
}

// The original seven-byte prefix plus each one/two-character deletion is indexed.
// Hash collisions only add verification work; exact distance checking below
// prevents them from producing incorrect matches.
fn signature_hashes(bytes: &[u8], limit: usize) -> ([u32; SIGNATURES_PER_WORD], usize) {
    let prefix = &bytes[..bytes.len().min(PREFIX_LEN)];
    let mut hashes = [0; SIGNATURES_PER_WORD];
    let mut count = 0;
    let mut add = |omit_one: usize, omit_two: usize| {
        let removed = usize::from(omit_one < prefix.len()) + usize::from(omit_two < prefix.len());
        let length = prefix.len() - removed;
        let mut hash = 2_166_136_261u32 ^ length as u32;
        for (index, &byte) in prefix.iter().enumerate() {
            if index == omit_one || index == omit_two { continue; }
            hash = (hash ^ byte as u32).wrapping_mul(16_777_619);
        }
        hash ^= hash >> 16;
        if !hashes[..count].contains(&hash) {
            hashes[count] = hash;
            count += 1;
        }
    };
    add(usize::MAX, usize::MAX);
    for first in 0..prefix.len() {
        add(first, usize::MAX);
        if limit >= 2 {
            for second in first + 1..prefix.len() { add(first, second); }
        }
    }
    (hashes, count)
}

// Banded optimal-string-alignment Damerau distance, capped at limit + 1.
// Fixed stack storage only: lookup performs no heap allocation.
fn bounded_distance(left: &[u8], right: &[u8], limit: usize) -> usize {
    if left.len().abs_diff(right.len()) > limit { return limit + 1; }
    let cap = (limit + 1) as u8;
    let mut matrix = [[cap; MAX_WORD_LEN + 1]; MAX_WORD_LEN + 1];
    for index in 0..=left.len().min(limit) { matrix[index][0] = index as u8; }
    for index in 0..=right.len().min(limit) { matrix[0][index] = index as u8; }
    for i in 1..=left.len() {
        let start = i.saturating_sub(limit).max(1);
        let end = right.len().min(i + limit);
        let mut minimum = matrix[i][0];
        for j in start..=end {
            let substitution = matrix[i - 1][j - 1] + u8::from(left[i - 1] != right[j - 1]);
            let mut distance = substitution.min(matrix[i - 1][j] + 1).min(matrix[i][j - 1] + 1);
            if i > 1 && j > 1 && left[i - 1] == right[j - 2] && left[i - 2] == right[j - 1] {
                distance = distance.min(matrix[i - 2][j - 2] + 1);
            }
            matrix[i][j] = distance.min(cap);
            minimum = minimum.min(matrix[i][j]);
        }
        if minimum as usize > limit { return limit + 1; }
    }
    matrix[left.len()][right.len()] as usize
}

// Exact restricted Damerau/optimal-string-alignment distance == 1: a single
// insertion, deletion, substitution, or adjacent transposition. No allocation.
fn one_edit(left: &[u8], right: &[u8]) -> bool {
    if left.len().abs_diff(right.len()) > 1 { return false; }
    let common = left.len().min(right.len());
    let mut first = 0;
    while first < common && left[first] == right[first] { first += 1; }
    if left.len() == right.len() {
        if first == common { return false; }
        if left[first + 1..] == right[first + 1..] { return true; }
        return first + 1 < common && left[first] == right[first + 1] &&
            left[first + 1] == right[first] && left[first + 2..] == right[first + 2..];
    }
    if left.len() < right.len() { left[first..] == right[first + 1..] }
    else { left[first + 1..] == right[first..] }
}

thread_local! { static ENGINE: RefCell<Engine> = RefCell::new(Engine::new()); }

#[no_mangle]
pub extern "C" fn input_ptr() -> u32 { ENGINE.with(|cell| cell.borrow().input.as_ptr() as u32) }
#[no_mangle]
pub extern "C" fn input_capacity() -> u32 { INPUT_CAPACITY as u32 }
#[no_mangle]
pub extern "C" fn max_words() -> u32 { MAX_WORDS as u32 }
#[no_mangle]
pub extern "C" fn reset() { ENGINE.with(|cell| cell.borrow_mut().reset()); }
#[no_mangle]
pub extern "C" fn add_word(pointer: u32, length: u32, frequency: f64) -> i32 {
    ENGINE.with(|cell| {
        let mut engine = cell.borrow_mut();
        let mut buffer = [0; MAX_WORD_LEN];
        match engine.read_input(pointer, length, &mut buffer) {
            Some(word) => engine.add(word, frequency),
            None => { engine.error = -1; -1 }
        }
    })
}
#[no_mangle]
pub extern "C" fn build_index() -> i32 { ENGINE.with(|cell| cell.borrow_mut().build()) }
#[no_mangle]
pub extern "C" fn known(pointer: u32, length: u32) -> u32 {
    ENGINE.with(|cell| {
        let mut engine = cell.borrow_mut();
        let mut buffer = [0; MAX_WORD_LEN];
        match engine.read_input(pointer, length, &mut buffer) {
            Some(word) => { engine.error = 0; u32::from(engine.exact.contains_key(word)) }
            None => { engine.error = -1; 0 }
        }
    })
}
#[no_mangle]
pub extern "C" fn lookup(pointer: u32, length: u32) -> i32 {
    ENGINE.with(|cell| {
        let mut engine = cell.borrow_mut();
        let mut buffer = [0; MAX_WORD_LEN];
        match engine.read_input(pointer, length, &mut buffer) {
            Some(word) => engine.lookup(word, 1),
            None => { engine.clear_result(); engine.error = -1; -1 }
        }
    })
}
#[no_mangle]
pub extern "C" fn lookup_with_limit(pointer: u32, length: u32, limit: u32) -> i32 {
    ENGINE.with(|cell| {
        let mut engine = cell.borrow_mut();
        let mut buffer = [0; MAX_WORD_LEN];
        if limit != 1 && limit != 2 {
            engine.clear_result();
            engine.error = -1;
            return -1;
        }
        match engine.read_input(pointer, length, &mut buffer) {
            Some(word) => engine.lookup(word, limit as usize),
            None => { engine.clear_result(); engine.error = -1; -1 }
        }
    })
}
#[no_mangle]
pub extern "C" fn word_count() -> u32 { ENGINE.with(|cell| cell.borrow().words.len() as u32) }
#[no_mangle]
pub extern "C" fn word_ptr(id: i32) -> u32 {
    ENGINE.with(|cell| if id < 0 { 0 } else { cell.borrow().words.get(id as usize).map_or(0, |word| word.text.as_ptr() as u32) })
}
#[no_mangle]
pub extern "C" fn word_len(id: i32) -> u32 {
    ENGINE.with(|cell| if id < 0 { 0 } else { cell.borrow().words.get(id as usize).map_or(0, |word| word.text.len() as u32) })
}
#[no_mangle]
pub extern "C" fn word_frequency(id: i32) -> f64 { ENGINE.with(|cell| cell.borrow().frequency(id)) }
#[no_mangle]
pub extern "C" fn second_id() -> i32 { ENGINE.with(|cell| cell.borrow().second) }
#[no_mangle]
pub extern "C" fn second_frequency() -> f64 { ENGINE.with(|cell| { let engine = cell.borrow(); engine.frequency(engine.second) }) }
#[no_mangle]
pub extern "C" fn candidate_count() -> u32 { ENGINE.with(|cell| cell.borrow().matches) }
#[no_mangle]
pub extern "C" fn examined_count() -> u32 { ENGINE.with(|cell| cell.borrow().examined) }
#[no_mangle]
pub extern "C" fn lookup_distance() -> i32 { ENGINE.with(|cell| cell.borrow().distance) }
#[no_mangle]
pub extern "C" fn last_error() -> i32 { ENGINE.with(|cell| cell.borrow().error) }
