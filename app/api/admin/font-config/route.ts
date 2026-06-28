import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';
import { ERA_FONTS, DEFAULT_ERA_FONTS } from '@/lib/era-fonts';
import { ERAS, type Era } from '@/lib/etymology-types';

function configKey(era: Era): string {
  return `era.${era}.font`;
}

function isValidFontId(era: Era, id: string): boolean {
  return ERA_FONTS[era].some((opt) => opt.id === id);
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const cfg = await getAllConfig();
  const out: Record<Era, string> = { ...DEFAULT_ERA_FONTS };
  for (const era of ERAS) {
    const v = cfg[configKey(era)];
    if (v && isValidFontId(era, v)) out[era] = v;
  }
  return NextResponse.json(out);
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  const changes: Array<{ era: Era; from: string; to: string }> = [];
  for (const era of ERAS) {
    const newId = body[era];
    if (newId === undefined) continue;
    if (typeof newId !== 'string' || !isValidFontId(era, newId)) {
      return NextResponse.json(
        { error: `invalid font id for ${era}: ${String(newId)}` },
        { status: 400 },
      );
    }
    updates[configKey(era)] = newId;
    if (newId !== DEFAULT_ERA_FONTS[era]) {
      changes.push({ era, from: DEFAULT_ERA_FONTS[era], to: newId });
    }
  }

  if (Object.keys(updates).length > 0) {
    await setConfigBatch(updates, auth.user.id);
    await writeAudit({
      userId: auth.user.id,
      event: 'admin.font_config.update',
      metadata: {
        changes: changes
          .map((c) => {
            const label = ERA_FONTS[c.era].find((o) => o.id === c.to)?.label ?? c.to;
            return `${c.era}: ${c.from} → ${label}`;
          })
          .join('; '),
      },
    });
  }
  return NextResponse.json({ ok: true, updated: Object.keys(updates) });
}
