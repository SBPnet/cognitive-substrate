declare module "snappyjs" {
  export function compress(input: Uint8Array | Buffer): Buffer;
  export function decompress(input: Uint8Array | Buffer): Uint8Array;
}
