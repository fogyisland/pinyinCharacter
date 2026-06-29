import { ERAS, type Era } from '@/lib/etymology-types';
import { getAllConfig } from '@/lib/config';
import { ERA_FONTS, DEFAULT_ERA_FONTS, type EraFontOption } from './era-fonts-data';

// Re-export for back-compat. Client-safe code should import from
// '@/lib/era-fonts-data' directly to avoid pulling mysql2 via this module.
export { ERA_FONTS, DEFAULT_ERA_FONTS };
export type { EraFontOption };

/** Resolve the active font ID per era from app_config, with default fallback.
 *  Used by /etymology/[char] RSC. Invalid IDs are silently ignored so that
 *  an admin deleting a font file can't crash etymology rendering.
 *  SERVER-ONLY — this function imports getAllConfig which loads mysql2. */
export async function getActiveEraFonts(): Promise<Record<Era, string>> {
  const cfg = await getAllConfig();
  const out: Record<Era, string> = { ...DEFAULT_ERA_FONTS };
  for (const era of ERAS) {
    const v = cfg[`era.${era}.font`];
    if (v && ERA_FONTS[era].some((opt: EraFontOption) => opt.id === v)) {
      out[era] = v;
    }
  }
  return out;
}