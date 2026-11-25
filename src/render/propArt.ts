// tools/prop-art.py の出力（手で編集しない。npm run props:art）。里に立てる小物の絵（ChatGPT の物語の原画 #13。v0.35.0）。
// 図集 public/assets/textures/props/props_story_v1.webp の中の、絵のある四角 [x0, y0, x1, y1]（px。左上が原点）と、絵の横 ÷ 縦。

export const PROP_ATLAS = { file: 'props_story_v1', w: 1536, h: 1024 } as const;

export interface PropArt {
  readonly rect: readonly [number, number, number, number];
  readonly aspect: number;
  /** 根元の横の位置（0 = 左端、1 = 右端）。板は、ここを軸に回る */
  readonly rootX: number;
  /** 原画のファイル（art-source/story/） */
  readonly source: string;
}

export const PROP_ART: Record<string, PropArt> = {
  route_lamp_on: { rect: [180, 6, 331, 506], aspect: 0.3013, rootX: 0.187, source: 'prop_story_route_lamp_on_v1.png' },
  route_lamp_off: { rect: [692, 6, 843, 506], aspect: 0.3011, rootX: 0.190, source: 'prop_story_route_lamp_off_v1.png' },
  closed_route_sign: { rect: [1030, 78, 1530, 506], aspect: 1.1695, rootX: 0.500, source: 'prop_story_closed_route_sign_v1.png' },
  supply_cart: { rect: [6, 665, 506, 1018], aspect: 1.4168, rootX: 0.500, source: 'prop_story_supply_cart_v1.png' },
  replaceable_parts: { rect: [518, 643, 1018, 1018], aspect: 1.3327, rootX: 0.500, source: 'prop_story_replaceable_parts_v1.png' },
  record_board: { rect: [1030, 637, 1530, 1018], aspect: 1.3113, rootX: 0.500, source: 'prop_story_record_board_v1.png' },
};
