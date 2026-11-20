/**
 * 对句的读取 —— 从 `data/duiyun-pairs.json` 拿数据。
 *
 * 数据文件是唯一的事实来源：期望的对句数量由这个文件决定，不写在别处。
 * 文件缺失是一个状态，不是一次故障 —— 读不到就把错误抛给调用方，由调用方
 * 决定怎么对界面说。
 */
import path from 'node:path';
import { readJsonAuto } from './json-fs';
import type { DuiyunPair } from './duiyun-rules';

const DATA_PATH = path.join(process.cwd(), 'data', 'duiyun-pairs.json');

/** 调用方要什么。 */
export interface ListDuiyunPairsOptions {
  /** 最多返回多少对。 */
  limit?: number;
}

/** 读全部对句。 */
export function listDuiyunPairs(options: ListDuiyunPairsOptions = {}): DuiyunPair[] {
  const raw = readJsonAuto(DATA_PATH);
  if (!raw) {
    throw new Error(`listDuiyunPairs: cannot read ${DATA_PATH}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`listDuiyunPairs: ${DATA_PATH} is not an array`);
  }
  const pairs = raw as DuiyunPair[];
  if (options.limit !== undefined && options.limit < pairs.length) {
    return pairs.slice(0, options.limit);
  }
  return pairs;
}

/** 数据文件里有多少对。 */
export function countDuiyunPairs(): number {
  return listDuiyunPairs().length;
}
