/** UTF-16 half-open source replacement. */
export interface EditChange {
  from: number;
  to: number;
  insert: string;
}
export interface EditorPlan {
  changes: EditChange[];
  cursor: number;
  selection?: { anchor: number; head: number };
}
export interface ReplacementPlan extends EditChange {
  raw?: string;
}
export interface RememberedReplacement {
  from: number;
  to: number;
  text: string;
  raw: string;
  word?: string;
}
