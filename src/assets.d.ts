declare module "*.wasm" {
  const base64: string;
  export default base64;
}
declare module "*.txt" {
  const text: string;
  export default text;
}
declare const HSTACK_SQL_WORKER: string;

declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}
