// to-ico 1.x ships without types. Minimal shim for our usage.
declare module 'to-ico' {
  function toIco(inputs: Buffer[]): Promise<Buffer>;
  export default toIco;
}
