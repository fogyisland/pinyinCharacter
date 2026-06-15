// 拆 SpeakOpts 到独立文件以避免循环引用(client/server 可能共用)
export interface SpeakOpts {
  rate?: number;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
}
