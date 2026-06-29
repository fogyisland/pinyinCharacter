import type { Era } from '@/lib/etymology-types';

/**
 * Client-safe era→font metadata. NO server-only imports here (no mysql2, no
 * next/server, no getAllConfig). Imported by both server and client code,
 * including the 'use client' components EtymologyMorph and FontConfigForm.
 *
 * The resolver that reads these from app_config lives in lib/era-fonts.ts
 * (which DOES depend on mysql2 and can only be imported server-side).
 */

export interface EraFontOption {
  /** CSS @font-face family ID — what gets passed to font-family. */
  id: string;
  /** Human-readable label for the admin dropdown. */
  label: string;
  /** File under public/fonts/ — null if the font is a system/local fallback. */
  file: string | null;
  /** Short description shown in admin UI (size, style, notes). */
  desc: string;
}

export const ERA_FONTS: Record<Era, EraFontOption[]> = {
  jiaguwen: [
    { id: 'Oracular',         label: 'Oracular (默认)',         file: 'Oracular-Regular.ttf',  desc: '32MB, 甲骨文, 1531 BMP chars' },
    { id: 'OracularInverted', label: 'Oracular 阴文',           file: 'Oracular-Inverted.ttf', desc: '白底黑字, 类似真实甲骨' },
    { id: 'YinQiJiaGuWen',    label: 'Founder 甲骨文',          file: 'founder-jiaguwen.ttf',  desc: '方正甲骨文, 旧默认, 2.7MB' },
  ],
  jinwen: [
    { id: 'WangHanzongWeibei', label: '王汉宗魏碑 (默认)',     file: 'wang-hanzong-weibei.ttf', desc: '10MB, 魏碑 ≈ 金文风格' },
    { id: 'HanDianJinWen',     label: 'BabelStone Han',         file: 'BabelStoneHanBasic.ttf',  desc: '25MB, 通用甲骨/金文/简帛 fallback' },
  ],
  xiaozhuan: [
    { id: 'QuanZiKuShuoWen',   label: '全字庫說文解字 (默认)', file: 'quanziku-shuowen.ttf',    desc: '10MB, 专用小篆' },
    { id: 'HanDianJinWen',     label: 'BabelStone Han',         file: 'BabelStoneHanBasic.ttf',  desc: '25MB, 通用 fallback' },
  ],
  lishu: [
    { id: 'WangHanzongLishu',  label: '王漢宗中隸書繁 (默认)', file: 'wang-hanzong-lishu.ttf',  desc: '8.1MB, 专用隶书' },
    { id: 'ZCOOLXiaoWei',      label: '站酷小薇',              file: 'zcool-xiaowei.ttf',       desc: '6.1MB, 现代隶书感' },
  ],
  kaishu: [
    { id: 'ZCOOLXiaoWei',      label: '站酷小薇 (默认)',       file: 'zcool-xiaowei.ttf',       desc: '6.1MB, react-pdf 兼容' },
    { id: 'KaiTi',             label: '系统楷体',              file: null,                      desc: 'local(KaiTi) / STKaiti / BiauKai' },
    { id: 'Iansui',            label: '汉仪润圆',              file: 'Iansui-Regular.woff2',    desc: '1.2MB, 圆润楷书' },
    { id: 'MaShanZheng',       label: '马善政',                file: 'ma-shan-zheng.woff2',     desc: '3.2MB, 楷书带毛笔感' },
  ],
};

export const DEFAULT_ERA_FONTS: Record<Era, string> = {
  jiaguwen: 'Oracular',
  jinwen: 'WangHanzongWeibei',
  xiaozhuan: 'QuanZiKuShuoWen',
  lishu: 'WangHanzongLishu',
  kaishu: 'ZCOOLXiaoWei',
};