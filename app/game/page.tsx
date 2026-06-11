import { DragMatchGame } from '@/components/game/DragMatchGame';

export const dynamic = 'force-dynamic';

export default function GamePage() {
  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-4 text-2xl font-bold">识字游戏</h1>
      <p className="mb-4 text-sm text-gray-600">
        从字库随机取 8 个字,把它们和对应的拼音配对。
      </p>
      <DragMatchGame />
    </div>
  );
}
