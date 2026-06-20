/**
 * Pull public-domain Chinese classics (醒世恒言, 汉书, 警世通言, etc.)
 * from guwendao.net (原古诗文网) and persist them to:
 *   1. data/classics/<slug>.json   (source of truth, version-controlled)
 *   2. data/classics-manifest.json (index of all classics)
 *   3. MySQL `classics` table      (live query layer)
 *
 * Source HTML pattern: <div class="contson"> ... </div> holding <p>
 * paragraphs and <br/> line breaks (used for inline poetry).
 *
 * Idempotent: re-running UPSERTs the same slug, rewrites the JSON
 * and updates the manifest. Network-bound on outbound HTTPS to
 * www.guwendao.net.
 *
 * Usage: DATABASE_URL=<db> pnpm tsx scripts/build-classics-guwendao.ts
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { getPool, closePool } from '../lib/db';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const SOURCE_BASE = 'https://www.guwendao.net';
const UA = 'Mozilla/5.0 (compatible; pinyin-character-build/1.0)';
const DATA_DIR = join(process.cwd(), 'data', 'classics');
const MANIFEST_PATH = join(process.cwd(), 'data', 'classics-manifest.json');

interface ClassicVolume {
  slug: string;
  title: string;
  /** Inclusive 1-based chapter index range within the book. */
  fromIdx: number;
  toIdx: number;
}

interface ClassicFile {
  /** guwendao book id (the 32-hex after book_). */
  bookId: string;
  title: string;
  category: 'four-books' | 'five-classics' | 'mengxue' | 'philosophy' | 'history' | 'other';
  author: string | null;
  era: string | null;
  /**
   * Volumes for this book. Books ≤ ~25 chapters fit one row; larger
   * books must be split (e.g. 醒世恒言 → 上下两册) so each INSERT stays
   * under MySQL's `max_allowed_packet` (default 4MB).
   */
  volumes: ClassicVolume[];
}

const CLASSIC_FILES: ClassicFile[] = [
  // 冯梦龙 《三言》 — public-domain Ming short fiction
  {
    bookId: 'efdce10c023c',
    title: '醒世恒言',
    category: 'other',
    author: '冯梦龙',
    era: '明',
    volumes: [
      { slug: 'xingshi-hengyan-1', title: '醒世恒言·上册', fromIdx: 1, toIdx: 21 },
      { slug: 'xingshi-hengyan-2', title: '醒世恒言·下册', fromIdx: 22, toIdx: 41 },
    ],
  },
  {
    bookId: 'a43af020011d',
    title: '喻世明言',
    category: 'other',
    author: '冯梦龙',
    era: '明',
    volumes: [
      { slug: 'yushi-mingyan-1', title: '喻世明言·上册', fromIdx: 1, toIdx: 21 },
      { slug: 'yushi-mingyan-2', title: '喻世明言·下册', fromIdx: 22, toIdx: 41 },
    ],
  },
  {
    bookId: '63ff90f1ba65',
    title: '警世通言',
    category: 'other',
    author: '冯梦龙',
    era: '明',
    volumes: [
      { slug: 'jingshi-tongyan-1', title: '警世通言·上册', fromIdx: 1, toIdx: 21 },
      { slug: 'jingshi-tongyan-2', title: '警世通言·下册', fromIdx: 22, toIdx: 41 },
    ],
  },
  // 拍案惊奇 (凌濛初)
  {
    bookId: '35ee5e612f4b',
    title: '初刻拍案惊奇',
    category: 'other',
    author: '凌濛初',
    era: '明',
    volumes: [
      { slug: 'chuke-pa-an-1', title: '初刻拍案惊奇·上册', fromIdx: 1, toIdx: 20 },
      { slug: 'chuke-pa-an-2', title: '初刻拍案惊奇·下册', fromIdx: 21, toIdx: 40 },
    ],
  },
  {
    bookId: '6d965e09d656',
    title: '二刻拍案惊奇',
    category: 'other',
    author: '凌濛初',
    era: '明',
    volumes: [
      { slug: 'erke-pa-an-1', title: '二刻拍案惊奇·上册', fromIdx: 1, toIdx: 21 },
      { slug: 'erke-pa-an-2', title: '二刻拍案惊奇·下册', fromIdx: 22, toIdx: 41 },
    ],
  },
  // 五经 — only those available upstream
  {
    bookId: '09514c5b00f8',
    title: '礼记',
    category: 'five-classics',
    author: null,
    era: '西汉',
    volumes: [
      { slug: 'liji-1', title: '礼记·上册', fromIdx: 1, toIdx: 25 },
      { slug: 'liji-2', title: '礼记·下册', fromIdx: 26, toIdx: 49 },
    ],
  },
  {
    bookId: 'e4ecba4b9fc4',
    title: '尚书',
    category: 'five-classics',
    author: null,
    era: '上古',
    volumes: [
      { slug: 'shangshu-1', title: '尚书·上册', fromIdx: 1, toIdx: 28 },
      { slug: 'shangshu-2', title: '尚书·下册', fromIdx: 29, toIdx: 56 },
    ],
  },
  {
    bookId: 'f726eab9800a',
    title: '仪礼',
    category: 'five-classics',
    author: null,
    era: '西周',
    volumes: [{ slug: 'yili', title: '仪礼', fromIdx: 1, toIdx: 17 }],
  },
  {
    bookId: 'd0e63da87d55',
    title: '孝经',
    category: 'five-classics',
    author: null,
    era: '春秋',
    volumes: [{ slug: 'xiaojing', title: '孝经', fromIdx: 1, toIdx: 18 }],
  },
  {
    bookId: '679daef1f0ad',
    title: '尔雅',
    category: 'five-classics',
    author: null,
    era: '战国',
    volumes: [{ slug: 'erya', title: '尔雅', fromIdx: 1, toIdx: 19 }],
  },
  // 二十四史 (史家) — 汉书/后汉书 + 其他正史
  {
    bookId: 'c6a0e66fd254',
    title: '汉书',
    category: 'history',
    author: '班固',
    era: '东汉',
    volumes: [
      { slug: 'hanshu-1', title: '汉书·卷一', fromIdx: 1, toIdx: 30 },
      { slug: 'hanshu-2', title: '汉书·卷二', fromIdx: 31, toIdx: 60 },
      { slug: 'hanshu-3', title: '汉书·卷三', fromIdx: 61, toIdx: 90 },
      { slug: 'hanshu-4', title: '汉书·卷四', fromIdx: 91, toIdx: 120 },
    ],
  },
  {
    bookId: '62efc075fe05',
    title: '后汉书',
    category: 'history',
    author: '范晔',
    era: '刘宋',
    volumes: [
      { slug: 'hou-hanshu-1', title: '后汉书·卷一', fromIdx: 1, toIdx: 33 },
      { slug: 'hou-hanshu-2', title: '后汉书·卷二', fromIdx: 34, toIdx: 65 },
      { slug: 'hou-hanshu-3', title: '后汉书·卷三', fromIdx: 66, toIdx: 100 },
      { slug: 'hou-hanshu-4', title: '后汉书·卷四', fromIdx: 101, toIdx: 130 },
    ],
  },
  {
    bookId: 'e905beeb5064',
    title: '三国志',
    category: 'history',
    author: '陈寿',
    era: '西晋',
    volumes: [
      { slug: 'sanguozhi-1', title: '三国志·卷一', fromIdx: 1, toIdx: 33 },
      { slug: 'sanguozhi-2', title: '三国志·卷二', fromIdx: 34, toIdx: 65 },
    ],
  },
  {
    bookId: '129e5598da43',
    title: '梁书',
    category: 'history',
    author: '姚思廉',
    era: '唐',
    volumes: [
      { slug: 'liangshu-1', title: '梁书·卷一', fromIdx: 1, toIdx: 30 },
      { slug: 'liangshu-2', title: '梁书·卷二', fromIdx: 31, toIdx: 56 },
    ],
  },
  {
    bookId: 'a64dac410659',
    title: '北齐书',
    category: 'history',
    author: '李百药',
    era: '唐',
    volumes: [{ slug: 'beiqishu', title: '北齐书', fromIdx: 1, toIdx: 50 }],
  },
  {
    bookId: '65c8dcaf8257',
    title: '周书',
    category: 'history',
    author: '令狐德棻',
    era: '唐',
    volumes: [{ slug: 'zhoushu', title: '周书', fromIdx: 1, toIdx: 50 }],
  },
  {
    bookId: 'b7efbbca5b32',
    title: '新五代史',
    category: 'history',
    author: '欧阳修',
    era: '宋',
    volumes: [
      { slug: 'xinwudaishi-1', title: '新五代史·卷一', fromIdx: 1, toIdx: 37 },
      { slug: 'xinwudaishi-2', title: '新五代史·卷二', fromIdx: 38, toIdx: 74 },
    ],
  },
  // 蒙学 (Children's classics / Conduct)
  {
    bookId: '070822573a07',
    title: '朱子家训',
    category: 'mengxue',
    author: '朱柏庐',
    era: '清',
    volumes: [{ slug: 'zhuzi-jiaxun', title: '朱子家训', fromIdx: 1, toIdx: 1 }],
  },
  {
    bookId: '863bfb5744b3',
    title: '名贤集',
    category: 'mengxue',
    author: null,
    era: '宋',
    volumes: [{ slug: 'mingxianji', title: '名贤集', fromIdx: 1, toIdx: 4 }],
  },
  {
    bookId: '725bfb5619a9',
    title: '格言联璧',
    category: 'mengxue',
    author: '金缨',
    era: '清',
    volumes: [
      { slug: 'geyan-lianbi-1', title: '格言联璧·上册', fromIdx: 1, toIdx: 6 },
      { slug: 'geyan-lianbi-2', title: '格言联璧·下册', fromIdx: 7, toIdx: 11 },
    ],
  },
  {
    bookId: 'e4d81a7d60bd',
    title: '颜氏家训',
    category: 'mengxue',
    author: '颜之推',
    era: '南北朝',
    volumes: [
      { slug: 'yanshi-jiaxun-1', title: '颜氏家训·上册', fromIdx: 1, toIdx: 10 },
      { slug: 'yanshi-jiaxun-2', title: '颜氏家训·下册', fromIdx: 11, toIdx: 20 },
    ],
  },
  {
    bookId: 'f4b9d6ab25d0',
    title: '了凡四训',
    category: 'mengxue',
    author: '袁了凡',
    era: '明',
    volumes: [{ slug: 'liaofan-sixun', title: '了凡四训', fromIdx: 1, toIdx: 4 }],
  },
  {
    bookId: '83c0c4f4b3a1',
    title: '菜根谭',
    category: 'mengxue',
    author: '洪应明',
    era: '明',
    volumes: [{ slug: 'caigentan', title: '菜根谭', fromIdx: 1, toIdx: 5 }],
  },
  {
    bookId: 'bbea3f5d2919',
    title: '小窗幽记',
    category: 'mengxue',
    author: '陈继儒',
    era: '明',
    volumes: [
      { slug: 'xiaochuang-youji-1', title: '小窗幽记·上册', fromIdx: 1, toIdx: 6 },
      { slug: 'xiaochuang-youji-2', title: '小窗幽记·下册', fromIdx: 7, toIdx: 12 },
    ],
  },
  {
    bookId: 'e69b18701f00',
    title: '呻吟语',
    category: 'mengxue',
    author: '吕坤',
    era: '明',
    volumes: [
      { slug: 'shenyinyu-1', title: '呻吟语·上册', fromIdx: 1, toIdx: 9 },
      { slug: 'shenyinyu-2', title: '呻吟语·下册', fromIdx: 10, toIdx: 18 },
    ],
  },
  {
    bookId: '1b2874f763ff',
    title: '声律启蒙',
    category: 'mengxue',
    author: '车万育',
    era: '清',
    volumes: [
      { slug: 'shenglv-qimeng-1', title: '声律启蒙·上册', fromIdx: 1, toIdx: 15 },
      { slug: 'shenglv-qimeng-2', title: '声律启蒙·下册', fromIdx: 16, toIdx: 30 },
    ],
  },
  {
    bookId: '285366189b25',
    title: '笠翁对韵',
    category: 'mengxue',
    author: '李渔',
    era: '清',
    volumes: [
      { slug: 'liweng-duiyun-1', title: '笠翁对韵·上册', fromIdx: 1, toIdx: 15 },
      { slug: 'liweng-duiyun-2', title: '笠翁对韵·下册', fromIdx: 16, toIdx: 30 },
    ],
  },
  // 诸子/哲学 — 儒道法墨杂家
  {
    bookId: 'd9e9f00fa83c',
    title: '鬼谷子',
    category: 'philosophy',
    author: '王诩',
    era: '战国',
    volumes: [
      { slug: 'guiguzi-1', title: '鬼谷子·上册', fromIdx: 1, toIdx: 11 },
      { slug: 'guiguzi-2', title: '鬼谷子·下册', fromIdx: 12, toIdx: 21 },
    ],
  },
  {
    bookId: '69c502d5c006',
    title: '列子',
    category: 'philosophy',
    author: '列御寇',
    era: '战国',
    volumes: [
      { slug: 'liezi-1', title: '列子·上册', fromIdx: 1, toIdx: 4 },
      { slug: 'liezi-2', title: '列子·下册', fromIdx: 5, toIdx: 8 },
    ],
  },
  {
    bookId: 'bfcc9d090ed5',
    title: '淮南子',
    category: 'philosophy',
    author: '刘安',
    era: '西汉',
    volumes: [
      { slug: 'huainanzi-1', title: '淮南子·上册', fromIdx: 1, toIdx: 11 },
      { slug: 'huainanzi-2', title: '淮南子·下册', fromIdx: 12, toIdx: 21 },
    ],
  },
  {
    bookId: 'fcb502e3f55d',
    title: '商君书',
    category: 'philosophy',
    author: '商鞅',
    era: '战国',
    volumes: [
      { slug: 'shangjunshu-1', title: '商君书·上册', fromIdx: 1, toIdx: 12 },
      { slug: 'shangjunshu-2', title: '商君书·下册', fromIdx: 13, toIdx: 24 },
    ],
  },
  {
    bookId: '8e814adbf214',
    title: '文子',
    category: 'philosophy',
    author: '辛妍',
    era: '战国',
    volumes: [
      { slug: 'wenzi-1', title: '文子·上册', fromIdx: 1, toIdx: 7 },
      { slug: 'wenzi-2', title: '文子·下册', fromIdx: 8, toIdx: 13 },
    ],
  },
  {
    bookId: 'd4a32fe1cf13',
    title: '人物志',
    category: 'philosophy',
    author: '刘劭',
    era: '三国',
    volumes: [
      { slug: 'renwuzhi-1', title: '人物志·上册', fromIdx: 1, toIdx: 7 },
      { slug: 'renwuzhi-2', title: '人物志·下册', fromIdx: 8, toIdx: 13 },
    ],
  },
  {
    bookId: 'fd16e7ead121',
    title: '文始真经',
    category: 'philosophy',
    author: '关尹子',
    era: '春秋',
    volumes: [
      { slug: 'wenshi-zhenjing-1', title: '文始真经·上册', fromIdx: 1, toIdx: 5 },
      { slug: 'wenshi-zhenjing-2', title: '文始真经·下册', fromIdx: 6, toIdx: 9 },
    ],
  },
  {
    bookId: '7ffb7fb24af2',
    title: '传习录',
    category: 'philosophy',
    author: '王阳明',
    era: '明',
    volumes: [
      { slug: 'chuanxilu-1', title: '传习录·上册', fromIdx: 1, toIdx: 9 },
      { slug: 'chuanxilu-2', title: '传习录·下册', fromIdx: 10, toIdx: 17 },
    ],
  },
  {
    bookId: 'f38f3b211c76',
    title: '庄子',
    category: 'philosophy',
    author: '庄周',
    era: '战国',
    volumes: [
      { slug: 'zhuangzi-1', title: '庄子·内篇', fromIdx: 1, toIdx: 17 },
      { slug: 'zhuangzi-2', title: '庄子·外篇', fromIdx: 18, toIdx: 33 },
    ],
  },
  {
    bookId: 'e8bf28de6a4b',
    title: '荀子',
    category: 'philosophy',
    author: '荀况',
    era: '战国',
    volumes: [
      { slug: 'xunzi-1', title: '荀子·上册', fromIdx: 1, toIdx: 16 },
      { slug: 'xunzi-2', title: '荀子·下册', fromIdx: 17, toIdx: 32 },
    ],
  },
  {
    bookId: '3b6401758902',
    title: '韩非子',
    category: 'philosophy',
    author: '韩非',
    era: '战国',
    volumes: [
      { slug: 'hanfeizi-1', title: '韩非子·上册', fromIdx: 1, toIdx: 28 },
      { slug: 'hanfeizi-2', title: '韩非子·下册', fromIdx: 29, toIdx: 55 },
    ],
  },
  {
    bookId: '1a02b10fe543',
    title: '墨子',
    category: 'philosophy',
    author: '墨翟',
    era: '战国',
    volumes: [
      { slug: 'mozi-1', title: '墨子·上册', fromIdx: 1, toIdx: 27 },
      { slug: 'mozi-2', title: '墨子·下册', fromIdx: 28, toIdx: 53 },
    ],
  },
  {
    bookId: '4660f958c5cf',
    title: '管子',
    category: 'philosophy',
    author: '管仲',
    era: '春秋',
    volumes: [
      { slug: 'guanzi-1', title: '管子·上册', fromIdx: 1, toIdx: 38 },
      { slug: 'guanzi-2', title: '管子·下册', fromIdx: 39, toIdx: 76 },
    ],
  },
  {
    bookId: '79a6898275a2',
    title: '抱朴子',
    category: 'philosophy',
    author: '葛洪',
    era: '东晋',
    volumes: [
      { slug: 'baopuzi-1', title: '抱朴子·上册', fromIdx: 1, toIdx: 35 },
      { slug: 'baopuzi-2', title: '抱朴子·下册', fromIdx: 36, toIdx: 70 },
    ],
  },
  {
    bookId: 'b59f91268b84',
    title: '吕氏春秋',
    category: 'philosophy',
    author: '吕不韦',
    era: '战国',
    volumes: [
      { slug: 'lvshi-chunqiu-1', title: '吕氏春秋·上册', fromIdx: 1, toIdx: 13 },
      { slug: 'lvshi-chunqiu-2', title: '吕氏春秋·下册', fromIdx: 14, toIdx: 26 },
    ],
  },
  // 道教经典
  {
    bookId: 'fbe63e9b16fc',
    title: '心经',
    category: 'philosophy',
    author: '玄奘',
    era: '唐',
    volumes: [{ slug: 'xinjing', title: '心经', fromIdx: 1, toIdx: 1 }],
  },
  {
    bookId: 'de95a674bb98',
    title: '太上老君说常清静经',
    category: 'philosophy',
    author: null,
    era: '春秋',
    volumes: [{ slug: 'changqingjing', title: '太上老君说常清静经', fromIdx: 1, toIdx: 1 }],
  },
  {
    bookId: '56493ee72c23',
    title: '悟真篇',
    category: 'philosophy',
    author: '张伯端',
    era: '宋',
    volumes: [
      { slug: 'wuzhenpian-1', title: '悟真篇·上册', fromIdx: 1, toIdx: 4 },
      { slug: 'wuzhenpian-2', title: '悟真篇·下册', fromIdx: 5, toIdx: 8 },
    ],
  },
  {
    bookId: '9dc165ae7405',
    title: '太乙金华宗旨',
    category: 'philosophy',
    author: '魏伯阳',
    era: '唐',
    volumes: [
      { slug: 'taiyi-jinhua-1', title: '太乙金华宗旨·上册', fromIdx: 1, toIdx: 7 },
      { slug: 'taiyi-jinhua-2', title: '太乙金华宗旨·下册', fromIdx: 8, toIdx: 13 },
    ],
  },
  {
    bookId: '1ae31193f043',
    title: '黄庭经',
    category: 'philosophy',
    author: '魏华存',
    era: '晋',
    volumes: [
      { slug: 'huangting-1', title: '黄庭经·上册', fromIdx: 1, toIdx: 20 },
      { slug: 'huangting-2', title: '黄庭经·下册', fromIdx: 21, toIdx: 40 },
    ],
  },
  // 兵家 (Military)
  {
    bookId: 'c412f1d0ea81',
    title: '孙子兵法',
    category: 'philosophy',
    author: '孙武',
    era: '春秋',
    volumes: [
      { slug: 'sunzi-bingfa-1', title: '孙子兵法·上册', fromIdx: 1, toIdx: 7 },
      { slug: 'sunzi-bingfa-2', title: '孙子兵法·下册', fromIdx: 8, toIdx: 13 },
    ],
  },
  {
    bookId: '3f426dfee2f8',
    title: '吴子',
    category: 'philosophy',
    author: '吴起',
    era: '战国',
    volumes: [
      { slug: 'wuzi-1', title: '吴子·上册', fromIdx: 1, toIdx: 3 },
      { slug: 'wuzi-2', title: '吴子·下册', fromIdx: 4, toIdx: 6 },
    ],
  },
  {
    bookId: '1695504e3fd0',
    title: '司马法',
    category: 'philosophy',
    author: '司马穰苴',
    era: '战国',
    volumes: [
      { slug: 'sima-fa-1', title: '司马法·上册', fromIdx: 1, toIdx: 3 },
      { slug: 'sima-fa-2', title: '司马法·下册', fromIdx: 4, toIdx: 5 },
    ],
  },
  {
    bookId: 'b047bbc36710',
    title: '三略',
    category: 'philosophy',
    author: null,
    era: '秦汉',
    volumes: [
      { slug: 'sanlve-1', title: '三略·上册', fromIdx: 1, toIdx: 2 },
      { slug: 'sanlve-2', title: '三略·下册', fromIdx: 3, toIdx: 3 }],
  },
  {
    bookId: 'a8af31e22938',
    title: '兵法二十四篇',
    category: 'philosophy',
    author: '诸葛亮',
    era: '三国',
    volumes: [
      { slug: 'bingfa-24-1', title: '兵法二十四篇·上册', fromIdx: 1, toIdx: 10 },
      { slug: 'bingfa-24-2', title: '兵法二十四篇·下册', fromIdx: 11, toIdx: 20 },
    ],
  },
  {
    bookId: '1a363b21b83a',
    title: '六韬',
    category: 'philosophy',
    author: '姜子牙',
    era: '周',
    volumes: [
      { slug: 'liutao-1', title: '六韬·上册', fromIdx: 1, toIdx: 30 },
      { slug: 'liutao-2', title: '六韬·下册', fromIdx: 31, toIdx: 60 },
    ],
  },
  {
    bookId: 'e11903fd10cd',
    title: '三十六计',
    category: 'philosophy',
    author: null,
    era: '明清',
    volumes: [
      { slug: 'sanshiliu-ji-1', title: '三十六计·上册', fromIdx: 1, toIdx: 18 },
      { slug: 'sanshiliu-ji-2', title: '三十六计·下册', fromIdx: 19, toIdx: 36 },
    ],
  },
  {
    bookId: 'f053f6df717d',
    title: '孙膑兵法',
    category: 'philosophy',
    author: '孙膑',
    era: '战国',
    volumes: [
      { slug: 'sunbin-bingfa-1', title: '孙膑兵法·上册', fromIdx: 1, toIdx: 15 },
      { slug: 'sunbin-bingfa-2', title: '孙膑兵法·下册', fromIdx: 16, toIdx: 30 },
    ],
  },
  {
    bookId: 'f85cbdb83bfd',
    title: '将苑',
    category: 'philosophy',
    author: '诸葛亮',
    era: '三国',
    volumes: [
      { slug: 'jiangyuan-1', title: '将苑·上册', fromIdx: 1, toIdx: 25 },
      { slug: 'jiangyuan-2', title: '将苑·下册', fromIdx: 26, toIdx: 50 },
    ],
  },
  // 志怪/笔记
  {
    bookId: '4e6b88d8a0bc',
    title: '山海经',
    category: 'other',
    author: null,
    era: '战国',
    volumes: [
      { slug: 'shanhaijing-1', title: '山海经·上册', fromIdx: 1, toIdx: 9 },
      { slug: 'shanhaijing-2', title: '山海经·下册', fromIdx: 10, toIdx: 18 },
    ],
  },
  {
    bookId: 'f18dc4b6b06d',
    title: '搜神记',
    category: 'other',
    author: '干宝',
    era: '东晋',
    volumes: [
      { slug: 'soushenji-1', title: '搜神记·上册', fromIdx: 1, toIdx: 10 },
      { slug: 'soushenji-2', title: '搜神记·下册', fromIdx: 11, toIdx: 20 },
    ],
  },
  {
    bookId: '733130278115',
    title: '搜神后记',
    category: 'other',
    author: '陶潜',
    era: '东晋',
    volumes: [
      { slug: 'soushen-houji-1', title: '搜神后记·上册', fromIdx: 1, toIdx: 5 },
      { slug: 'soushen-houji-2', title: '搜神后记·下册', fromIdx: 6, toIdx: 10 },
    ],
  },
  {
    bookId: '079ac52f7530',
    title: '幽明录',
    category: 'other',
    author: '刘义庆',
    era: '南朝',
    volumes: [
      { slug: 'youminglu-1', title: '幽明录·上册', fromIdx: 1, toIdx: 3 },
      { slug: 'youminglu-2', title: '幽明录·下册', fromIdx: 4, toIdx: 6 },
    ],
  },
  {
    bookId: 'a5b24761c8ca',
    title: '博物志',
    category: 'other',
    author: '张华',
    era: '西晋',
    volumes: [
      { slug: 'bowuzhi-1', title: '博物志·上册', fromIdx: 1, toIdx: 6 },
      { slug: 'bowuzhi-2', title: '博物志·下册', fromIdx: 7, toIdx: 11 },
    ],
  },
  {
    bookId: 'ada8815b596b',
    title: '神仙传',
    category: 'other',
    author: '葛洪',
    era: '东晋',
    volumes: [
      { slug: 'shenxian-zhuan-1', title: '神仙传·上册', fromIdx: 1, toIdx: 5 },
      { slug: 'shenxian-zhuan-2', title: '神仙传·下册', fromIdx: 6, toIdx: 10 },
    ],
  },
  {
    bookId: '8b84d2e6e9fc',
    title: '幽梦影',
    category: 'other',
    author: '张潮',
    era: '清',
    volumes: [
      { slug: 'youmengying-1', title: '幽梦影·上册', fromIdx: 1, toIdx: 1 },
      { slug: 'youmengying-2', title: '幽梦影·下册', fromIdx: 2, toIdx: 2 },
    ],
  },
  {
    bookId: 'dd3be015cff8',
    title: '新齐谐',
    category: 'other',
    author: '袁枚',
    era: '清',
    volumes: [
      { slug: 'xinqixie-1', title: '新齐谐·上册', fromIdx: 1, toIdx: 13 },
      { slug: 'xinqixie-2', title: '新齐谐·下册', fromIdx: 14, toIdx: 25 },
    ],
  },
  {
    bookId: '406ec46ca000',
    title: '酉阳杂俎',
    category: 'other',
    author: '段成式',
    era: '唐',
    volumes: [
      { slug: 'yoyang-zazu-1', title: '酉阳杂俎·上册', fromIdx: 1, toIdx: 16 },
      { slug: 'yoyang-zazu-2', title: '酉阳杂俎·下册', fromIdx: 17, toIdx: 31 },
    ],
  },
  {
    bookId: 'bbf0d02a401c',
    title: '世说新语',
    category: 'other',
    author: '刘义庆',
    era: '南朝',
    volumes: [
      { slug: 'shishuo-xinyu-1', title: '世说新语·上册', fromIdx: 1, toIdx: 18 },
      { slug: 'shishuo-xinyu-2', title: '世说新语·下册', fromIdx: 19, toIdx: 36 },
    ],
  },
  {
    bookId: '076e2373fc61',
    title: '梦溪笔谈',
    category: 'other',
    author: '沈括',
    era: '宋',
    volumes: [
      { slug: 'mengxi-bitan-1', title: '梦溪笔谈·上册', fromIdx: 1, toIdx: 15 },
      { slug: 'mengxi-bitan-2', title: '梦溪笔谈·下册', fromIdx: 16, toIdx: 30 },
    ],
  },
  {
    bookId: '603e4859dbf7',
    title: '剪灯新话',
    category: 'other',
    author: '瞿佑',
    era: '明',
    volumes: [
      { slug: 'jiandeng-xinhua-1', title: '剪灯新话·上册', fromIdx: 1, toIdx: 13 },
      { slug: 'jiandeng-xinhua-2', title: '剪灯新话·下册', fromIdx: 14, toIdx: 26 },
    ],
  },
  // 明清小说/笔记
  {
    bookId: 'ea10458ec235',
    title: '浮生六记',
    category: 'other',
    author: '沈复',
    era: '清',
    volumes: [
      { slug: 'fusheng-liuji-1', title: '浮生六记·上册', fromIdx: 1, toIdx: 2 },
      { slug: 'fusheng-liuji-2', title: '浮生六记·下册', fromIdx: 3, toIdx: 4 },
    ],
  },
  {
    bookId: '904e1676744f',
    title: '老残游记',
    category: 'other',
    author: '刘鹗',
    era: '清',
    volumes: [
      { slug: 'laocan-youji-1', title: '老残游记·上册', fromIdx: 1, toIdx: 11 },
      { slug: 'laocan-youji-2', title: '老残游记·下册', fromIdx: 12, toIdx: 21 },
    ],
  },
  {
    bookId: '9ec2c9145a8f',
    title: '笑林广记',
    category: 'other',
    author: '游戏主人',
    era: '清',
    volumes: [
      { slug: 'xiaolin-guangji-1', title: '笑林广记·上册', fromIdx: 1, toIdx: 6 },
      { slug: 'xiaolin-guangji-2', title: '笑林广记·下册', fromIdx: 7, toIdx: 12 },
    ],
  },
  {
    bookId: '791063234900',
    title: '儒林外史',
    category: 'other',
    author: '吴敬梓',
    era: '清',
    volumes: [
      { slug: 'rulin-waishi-1', title: '儒林外史·上册', fromIdx: 1, toIdx: 28 },
      { slug: 'rulin-waishi-2', title: '儒林外史·下册', fromIdx: 29, toIdx: 56 },
    ],
  },
  {
    bookId: '8dac137f5924',
    title: '官场现形记',
    category: 'other',
    author: '李宝嘉',
    era: '清',
    volumes: [
      { slug: 'guanchang-xianxing-1', title: '官场现形记·上册', fromIdx: 1, toIdx: 30 },
      { slug: 'guanchang-xianxing-2', title: '官场现形记·下册', fromIdx: 31, toIdx: 60 },
    ],
  },
  // 中医 (Medicine) — 全部入 'other'
  {
    bookId: '82865fcafa01',
    title: '伤寒论',
    category: 'other',
    author: '张仲景',
    era: '东汉',
    volumes: [
      { slug: 'shanghan-lun-1', title: '伤寒论·上册', fromIdx: 1, toIdx: 12 },
      { slug: 'shanghan-lun-2', title: '伤寒论·下册', fromIdx: 13, toIdx: 24 },
    ],
  },
  {
    bookId: 'edd0fc49a275',
    title: '金匮要略',
    category: 'other',
    author: '张仲景',
    era: '东汉',
    volumes: [
      { slug: 'jinkui-yaolve-1', title: '金匮要略·上册', fromIdx: 1, toIdx: 13 },
      { slug: 'jinkui-yaolve-2', title: '金匮要略·下册', fromIdx: 14, toIdx: 25 },
    ],
  },
  {
    bookId: 'd8b854fd7143',
    title: '奇经八脉考',
    category: 'other',
    author: '李时珍',
    era: '明',
    volumes: [
      { slug: 'qijing-bamai-1', title: '奇经八脉考·上册', fromIdx: 1, toIdx: 9 },
      { slug: 'qijing-bamai-2', title: '奇经八脉考·下册', fromIdx: 10, toIdx: 18 },
    ],
  },
  {
    bookId: '64c159c2814f',
    title: '药性歌括四百味',
    category: 'other',
    author: '龚廷贤',
    era: '明',
    volumes: [
      { slug: 'yaoxing-gesuo-1', title: '药性歌括四百味·上册', fromIdx: 1, toIdx: 2 },
      { slug: 'yaoxing-gesuo-2', title: '药性歌括四百味·下册', fromIdx: 3, toIdx: 4 },
    ],
  },
  {
    bookId: 'f53a5ee5bb6a',
    title: '濒湖脉学',
    category: 'other',
    author: '李时珍',
    era: '明',
    volumes: [
      { slug: 'binhu-maixue-1', title: '濒湖脉学·上册', fromIdx: 1, toIdx: 15 },
      { slug: 'binhu-maixue-2', title: '濒湖脉学·下册', fromIdx: 16, toIdx: 29 },
    ],
  },
  // 工艺/科技
  {
    bookId: '8d430e61b15e',
    title: '茶经',
    category: 'other',
    author: '陆羽',
    era: '唐',
    volumes: [
      { slug: 'chajing-1', title: '茶经·上册', fromIdx: 1, toIdx: 5 },
      { slug: 'chajing-2', title: '茶经·下册', fromIdx: 6, toIdx: 10 },
    ],
  },
  {
    bookId: '7ef275cd618d',
    title: '齐民要术',
    category: 'other',
    author: '贾思勰',
    era: '北魏',
    volumes: [
      { slug: 'qimin-yaoshu-1', title: '齐民要术·上册', fromIdx: 1, toIdx: 6 },
      { slug: 'qimin-yaoshu-2', title: '齐民要术·下册', fromIdx: 7, toIdx: 12 },
    ],
  },
  {
    bookId: '289e1e12ab2a',
    title: '天工开物',
    category: 'other',
    author: '宋应星',
    era: '明',
    volumes: [
      { slug: 'tiangong-kaiwu-1', title: '天工开物·上册', fromIdx: 1, toIdx: 10 },
      { slug: 'tiangong-kaiwu-2', title: '天工开物·下册', fromIdx: 11, toIdx: 19 },
    ],
  },
  {
    bookId: 'e61320980f9c',
    title: '随园食单',
    category: 'other',
    author: '袁枚',
    era: '清',
    volumes: [
      { slug: 'suiyuan-shidan-1', title: '随园食单·上册', fromIdx: 1, toIdx: 8 },
      { slug: 'suiyuan-shidan-2', title: '随园食单·下册', fromIdx: 9, toIdx: 15 },
    ],
  },
  // 算学/术数
  {
    bookId: '88f34d00f98c',
    title: '九章算术',
    category: 'other',
    author: null,
    era: '东汉',
    volumes: [
      { slug: 'jiuzhang-suanshu-1', title: '九章算术·上册', fromIdx: 1, toIdx: 5 },
      { slug: 'jiuzhang-suanshu-2', title: '九章算术·下册', fromIdx: 6, toIdx: 10 },
    ],
  },
  {
    bookId: 'bd39fa6c6fb4',
    title: '葬书',
    category: 'other',
    author: '郭璞',
    era: '晋',
    volumes: [
      { slug: 'zangshu-1', title: '葬书·上册', fromIdx: 1, toIdx: 2 },
      { slug: 'zangshu-2', title: '葬书·下册', fromIdx: 3, toIdx: 3 },
    ],
  },
  {
    bookId: 'fd1502b1700f',
    title: '渊海子平',
    category: 'other',
    author: '徐大升',
    era: '宋',
    volumes: [
      { slug: 'yuanhai-ziping-1', title: '渊海子平·上册', fromIdx: 1, toIdx: 6 },
      { slug: 'yuanhai-ziping-2', title: '渊海子平·下册', fromIdx: 7, toIdx: 12 },
    ],
  },
  // 杂家/语录
  {
    bookId: '7f51e554e184',
    title: '说苑',
    category: 'other',
    author: '刘向',
    era: '西汉',
    volumes: [
      { slug: 'shuoyuan-1', title: '说苑·上册', fromIdx: 1, toIdx: 10 },
      { slug: 'shuoyuan-2', title: '说苑·下册', fromIdx: 11, toIdx: 20 },
    ],
  },
  {
    bookId: 'bc2c2f3f76c5',
    title: '贞观政要',
    category: 'other',
    author: '吴兢',
    era: '唐',
    volumes: [
      { slug: 'zhenguan-zhengyao-1', title: '贞观政要·上册', fromIdx: 1, toIdx: 21 },
      { slug: 'zhenguan-zhengyao-2', title: '贞观政要·下册', fromIdx: 22, toIdx: 41 },
    ],
  },
  {
    bookId: '9bd135b79a36',
    title: '日知录',
    category: 'other',
    author: '顾炎武',
    era: '清',
    volumes: [
      { slug: 'rizhi-lu-1', title: '日知录·上册', fromIdx: 1, toIdx: 17 },
      { slug: 'rizhi-lu-2', title: '日知录·下册', fromIdx: 18, toIdx: 33 },
    ],
  },
  // 戏曲/文论
  {
    bookId: 'b2730fddcac2',
    title: '西厢记',
    category: 'other',
    author: '王实甫',
    era: '元',
    volumes: [
      { slug: 'xixiang-ji-1', title: '西厢记·上册', fromIdx: 1, toIdx: 13 },
      { slug: 'xixiang-ji-2', title: '西厢记·下册', fromIdx: 14, toIdx: 25 },
    ],
  },
  {
    bookId: '82f9f1d9b631',
    title: '沧浪诗话',
    category: 'other',
    author: '严羽',
    era: '宋',
    volumes: [
      { slug: 'canglang-shihua-1', title: '沧浪诗话·上册', fromIdx: 1, toIdx: 3 },
      { slug: 'canglang-shihua-2', title: '沧浪诗话·下册', fromIdx: 4, toIdx: 6 },
    ],
  },
  {
    bookId: '5b87255cd674',
    title: '文心雕龙',
    category: 'other',
    author: '刘勰',
    era: '南朝',
    volumes: [
      { slug: 'wenxin-diaolong-1', title: '文心雕龙·上册', fromIdx: 1, toIdx: 25 },
      { slug: 'wenxin-diaolong-2', title: '文心雕龙·下册', fromIdx: 26, toIdx: 50 },
    ],
  },
  {
    bookId: 'a058bba88fd1',
    title: '牡丹亭',
    category: 'other',
    author: '汤显祖',
    era: '明',
    volumes: [
      { slug: 'mudanting-1', title: '牡丹亭·上册', fromIdx: 1, toIdx: 28 },
      { slug: 'mudanting-2', title: '牡丹亭·下册', fromIdx: 29, toIdx: 56 },
    ],
  },
  {
    bookId: '4f63ebb6a4c2',
    title: '长生殿',
    category: 'other',
    author: '洪昇',
    era: '清',
    volumes: [
      { slug: 'changsheng-dian-1', title: '长生殿·上册', fromIdx: 1, toIdx: 25 },
      { slug: 'changsheng-dian-2', title: '长生殿·下册', fromIdx: 26, toIdx: 50 },
    ],
  },
  {
    bookId: '953510d9231e',
    title: '桃花扇',
    category: 'other',
    author: '孔尚任',
    era: '清',
    volumes: [
      { slug: 'taohua-shan-1', title: '桃花扇·上册', fromIdx: 1, toIdx: 22 },
      { slug: 'taohua-shan-2', title: '桃花扇·下册', fromIdx: 23, toIdx: 44 },
    ],
  },
];

interface ChapterRef {
  path: string;
  label: string;
}

interface ChunkJson {
  id: number;
  label: string;
  content: string[];
  pinyin: string[][];
}

interface VolumeJson {
  slug: string;
  title: string;
  category: string;
  author: string | null;
  era: string | null;
  source: string;
  bookId: string;
  bookTitle: string;
  chapterRange: { from: number; to: number };
  chunks: ChunkJson[];
}

interface ManifestEntry {
  slug: string;
  title: string;
  source: string;
  category: string;
  author: string | null;
  era: string | null;
  chapterCount: number;
  charCount: number;
  jsonFile: string;
  jsonBytes: number;
  bookId?: string;
  bookTitle?: string;
}

interface Manifest {
  version: 1;
  updatedAt: string;
  books: ManifestEntry[];
}

function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    const r = pinyin(ch, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(r) && r.length > 0 && typeof r[0] === 'string') return r[0]!;
  } catch {
    /* fall through */
  }
  return '';
}

function linePinyin(line: string): string[] {
  return Array.from(line).map(charPinyin);
}

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;|&ndash;/g, '—')
    .replace(/&hellip;/g, '…')
    .trim();
}

async function fetchHtml(path: string): Promise<string> {
  const url = SOURCE_BASE + path;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

/** Pull (path, label) pairs from a guwendao book index page. */
async function listChapters(bookId: string): Promise<ChapterRef[]> {
  const html = await fetchHtml(`/guwen/book_${bookId}.aspx`);
  const re = /href="(\/guwen\/bookv_[0-9a-f]+\.aspx)"[^>]*>([^<]+)/g;
  const seen = new Set<string>();
  const out: ChapterRef[] = [];
  for (const m of html.matchAll(re)) {
    const fullPath = m[1]!;
    const label = m[2]!.trim();
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);
    out.push({ path: fullPath, label });
  }
  return out;
}

/** Extract paragraph array from a guwendao chapter page. */
async function fetchChapterParagraphs(chapterPath: string): Promise<string[]> {
  const html = await fetchHtml(chapterPath);
  const m = html.match(/<div\s+class="contson"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) throw new Error(`no .contson div in ${chapterPath}`);
  const inner = m[1]!;
  const blocks = inner.split(/<\/p>/i).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((b) => stripTags(b))
    .map((p) => t2s(p))
    .filter((p) => p.length > 0);
}

function writeVolumeJson(vol: VolumeJson): { path: string; bytes: number } {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(vol, null, 2);
  const filePath = join(DATA_DIR, `${vol.slug}.json`);
  writeFileSync(filePath, json, 'utf8');
  return { path: filePath, bytes: json.length };
}

function countChars(chunks: ChunkJson[]): number {
  return chunks.reduce((n, c) => n + c.content.reduce((s, p) => s + Array.from(p).length, 0), 0);
}

/** Scan data/classics/ to rebuild manifest from JSON files on disk. */
function buildManifestFromDisk(): Manifest {
  const entries: ManifestEntry[] = [];
  if (!existsSync(DATA_DIR)) {
    return { version: 1, updatedAt: new Date().toISOString(), books: entries };
  }
  for (const name of readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json')) continue;
    const filePath = join(DATA_DIR, name);
    const stat = statSync(filePath);
    const vol: VolumeJson = JSON.parse(readFileSync(filePath, 'utf8'));
    entries.push({
      slug: vol.slug,
      title: vol.title,
      source: vol.source,
      category: vol.category,
      author: vol.author,
      era: vol.era,
      chapterCount: vol.chunks.length,
      charCount: countChars(vol.chunks),
      jsonFile: `data/classics/${name}`,
      jsonBytes: stat.size,
      bookId: vol.bookId,
      bookTitle: vol.bookTitle,
    });
  }
  // Stable sort: by category then by slug.
  entries.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.slug.localeCompare(b.slug)));
  return { version: 1, updatedAt: new Date().toISOString(), books: entries };
}

function writeManifest(): Manifest {
  if (!existsSync(join(process.cwd(), 'data'))) {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  }
  const manifest = buildManifestFromDisk();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

export async function buildClassicsGuwendao(): Promise<{ volumes: number; manifest: Manifest }> {
  const pool = getPool();
  let volumeCount = 0;
  for (const file of CLASSIC_FILES) {
    const sourceTag = `guwendao.net/${file.title}`;
    console.log(`[guwendao] ${file.title}: listing chapters…`);
    let chapters: ChapterRef[];
    try {
      chapters = await listChapters(file.bookId);
    } catch (err) {
      console.warn(`[guwendao] skip ${file.title}: ${(err as Error).message}`);
      continue;
    }
    if (chapters.length === 0) {
      console.warn(`[guwendao] skip ${file.title}: no chapters found`);
      continue;
    }
    console.log(`[guwendao] ${file.title}: ${chapters.length} chapters`);

    const allChunks: ChunkJson[] = [];
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i]!;
      try {
        const paragraphs = await fetchChapterParagraphs(c.path);
        const pinyinArr = paragraphs.map(linePinyin);
        allChunks.push({ id: i + 1, label: c.label.slice(0, 64), content: paragraphs, pinyin: pinyinArr });
        process.stdout.write(`  [${i + 1}/${chapters.length}] ${c.label} (${paragraphs.length} 段)\n`);
      } catch (err) {
        console.warn(`  [guwendao] skip chapter ${c.path}: ${(err as Error).message}`);
      }
    }
    if (allChunks.length === 0) {
      console.warn(`[guwendao] skip ${file.title}: no chunks after fetch`);
      continue;
    }

    for (const vol of file.volumes) {
      const slice = allChunks.slice(vol.fromIdx - 1, vol.toIdx);
      if (slice.length === 0) {
        console.warn(`[guwendao] skip ${vol.slug}: empty slice ${vol.fromIdx}-${vol.toIdx}`);
        continue;
      }
      const chunks = slice.map((c, i) => ({ ...c, id: i + 1 }));
      const json = JSON.stringify(chunks);
      const kb = Math.round(json.length / 1024);

      const volJson: VolumeJson = {
        slug: vol.slug,
        title: vol.title,
        category: file.category,
        author: file.author,
        era: file.era,
        source: sourceTag,
        bookId: file.bookId,
        bookTitle: file.title,
        chapterRange: { from: vol.fromIdx, to: vol.toIdx },
        chunks,
      };
      const { path: jsonPath, bytes } = writeVolumeJson(volJson);
      console.log(`[guwendao] ${vol.slug}: ${chunks.length} chapters, ${kb}KB JSON → ${jsonPath}`);

      await pool.execute(
        `INSERT INTO classics (slug, title, category, author, era, chunks, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           category = VALUES(category),
           author = VALUES(author),
           era = VALUES(era),
           chunks = VALUES(chunks),
           source = VALUES(source)`,
        [vol.slug, vol.title, file.category, file.author, file.era, json, sourceTag],
      );
      volumeCount++;
      console.log(`[guwendao] ${vol.slug}: written to DB`);
    }
  }
  const manifest = writeManifest();
  return { volumes: volumeCount, manifest };
}

if (require.main === module) {
  buildClassicsGuwendao()
    .then(({ volumes, manifest }) => {
      console.log(`[guwendao] inserted/updated ${volumes} volumes`);
      console.log(`[guwendao] manifest has ${manifest.books.length} books total`);
      return closePool();
    })
    .catch((err) => {
      console.error('[guwendao] failed:', err);
      process.exit(1);
    });
}
