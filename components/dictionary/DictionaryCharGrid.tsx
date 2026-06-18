import type { Char } from '@/lib/chars-types';
import { DictionaryCharGridClient } from './DictionaryCharGridClient';

export function DictionaryCharGrid({ chars }: { chars: Char[] }) {
  return <DictionaryCharGridClient chars={chars} />;
}
