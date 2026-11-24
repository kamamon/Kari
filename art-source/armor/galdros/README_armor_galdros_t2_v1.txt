霧境の狩人 — VEILBOUND HUNTERS
依頼7：ガルドロスT2 岩殻防具・A 4方向
作成日：2026年11月24日

納品した4枚（各1086×1448px、PNG）
A-1 armor_galdros_t2_front_v1.png
A-2 armor_galdros_t2_back_v1.png
A-3 armor_galdros_t2_left_v1.png
A-4 armor_galdros_t2_right_v1.png

A-1は兜の平坦化と手首の可動部を調整。その後、4方向とも兜の岩面を整え、青銅色を外周の縁だけに限定した最終画像を収録。
B armor_galdros_tiers_front_v1.png は未生成。ユーザーがAを「採用」と言った後の工程。

主な5色
岩板：灰褐色
鋲・留め具：青銅色
晶脈の縁と後腰の晶塊：琥珀色〜青銅色
革・帯・長靴：濃い茶色
下衣の厚布：生成り

ガルドロス由来の3つの特徴
1. 少数の大きな岩板と、低く平らな岩の兜。
2. 本人左が大きい非対称。左肩は大1枚、右肩は中1枚＋小1枚。左籠手と左腰板も大きい。
3. 青銅〜琥珀の縁と、尾先を写した小さな晶塊を後腰中央へ固定。

方向規則
正面：本人左＝画面右、本人右の袋＝画面左。
背面：本人左＝画面左、本人右の袋＝画面右。
左側面：顔は画像左。大きい肩・籠手・腰板が見える側。右の袋は反対側。
右側面：顔は画像右。中＋小の肩板、小さな籠手と腰板、道具袋が見える側。

3D制作で固定する数値と基準
体型・身長・骨格は採用ハンターと既存ゲーム側の設定を正本とし、広Aポーズを維持。以下の防具寸法は依頼7の指定。
岩板厚3〜4cm。兜の高さは頭頂から約6cmまで。
肩の張り出しは外へ約12cm、上へ約8cmまで。
腰板は太もも半ばまで。前を開く。膝と肘内側・手首を可動にする。
肩当ては胴の部品。頭・胴・腕・腰・脚の境界は元のリグを正本にする。
背中中央は平らな装備支持面。後腰の晶塊は腰部品へ固定。
生成画像は3D用の外観資料。実寸・関節位置・動作中の干渉は3Dで数値確認。

接地線の補正メモ（画像上の概算・0始まりのy座標）
前：足裏y≈1364
後：足裏y≈1366
左：足裏y≈1355
右：足裏y≈1354
前を基準にした画像位置合わせの目安：後を上へ2px、左を下へ9px、右を下へ10px。
最大差は約12px。換算例として身長1.75mを約1300pxと仮定すると、約1.6cm相当。1.75mはこの換算例の仮定で、依頼7から新たに決定した身長ではない。
これは画像の配置差を換算した値で、実際の人物の身長差を測定した値ではない。
暗い被写体と背景の境界から推定しており、境界の柔らかさにより数pxの誤差がある。
参照平面の上下位置を合わせ、モデルの足裏原点を0に固定する。画像全体の見かけだけで骨格を変えない。

表現上の補足
雷耐性のヒントとなる縁取りは、関節を硬い帯でつながず、各板の縁に分けている。
肩から腰・脛への配置によるつながりとし、可動部をまたぐ一本の連続した線にはしていない。
第2段階の基本方針は『晶脈は岩板の外周だけ、表面には伸ばさない』。
兜表面の青銅色の筋は最終調整で除去し、灰褐色の岩面と外周の縁に整理した。他の岩板に見える細かな割れ・凹凸は岩の表面模様であり、別々の小さな鱗や追加プレートには分割しない。3Dの色テクスチャでは、表面の割れ目を岩色のひびとして扱い、青銅〜琥珀の晶脈は外周に限定する。
最終4枚でも、画像の接地線と細かな表面模様は完全なピクセル一致ではない。板の枚数・左右・取り付け位置を優先し、正面の基準姿勢と既存リグに対して参照平面を合わせる。腕の振り上げ・回避・しゃがみの干渉確認は3D側で行う。

制作方法
組み込みの画像生成機能を使用。画像の形・色をPython等で描き直したものではない。
参照した原画：採用済み広Aポーズ正面、採用背面・左・右側面、顔正面、ガルドロス正面・背面、修正後アート基準ボード。

以下は実際に使った生成・調整プロンプト。ファイル名と方向を変えるだけで別防具へ流用せず、各モンスターの5つの特徴と採用画像を参照すること。

====================
front
====================
Use case: identity-preserve, original game equipment reference.
Create A-1 FRONT VIEW, a single full-body orthographic reference of the EXACT male hunter from input 1 wearing the tier-2 Galdros rock-shell armor described below. This is a wardrobe/armor edit of input 1, NOT a new person, pose, camera or body.
INPUT ROLES:
1) EDIT TARGET AND ABSOLUTE POSE/SCALE GUIDE: approved wide A-pose hunter front, 1086x1448. Keep his face, head/body proportions, shoulder joints, arm angles, hands, legs, boot size, foot positions and ground-contact line. Arms spread diagonally down exactly as shown. Retain the worn brown boots and his anatomical RIGHT-hip leather pouch (on VIEWER LEFT).
2) MATERIAL/SHAPE REFERENCE ONLY: Galdros front. Copy its broad chipped grey-brown stone plates with thin bronze/amber edges, low flat crown, and left-heavy asymmetry. Do NOT put the monster in the output.
3) ART STYLE/PALETTE REFERENCE ONLY: approved art board. Do not reproduce the board, weapons, setting, text or its hunter pose.
4) FACE IDENTITY ONLY: same hunter portrait. Preserve identity and neutral expression; remove the hood/cloak in the output.
COMPOSITION: exactly one figure, full head to soles, centered, truly straight-on orthographic FRONT, no perspective or three-quarter rotation. Portrait canvas 3:4, at least 1086x1448, ideally the same 1086x1448 framing as input 1. Preserve relative pixel landmarks and sole baseline of input 1; do not enlarge the torso or shorten limbs. Modest clear margin above helmet and below boots. Uniform light warm grey background matching input 1. Neutral soft even lighting, restrained form shading, absolutely NO ground/cast shadow, no floor, no vignette, no gradients, labels, lettering, dimensions, frames, watermark, weapons or extra objects.
ARMOR IS TIER 2, EARLY ROCK-SHELL: few LARGE FLAT CHIPPED GREY-BROWN STONE SLABS, about 3–4 cm thick over dark worn leather and unbleached cream heavy cloth. Not shiny steel armor, not a rock golem, not tiny scales. Natural cracks/chips on stone are dark stone-colored. Thin bronze-to-amber mineral veins run ONLY along plate OUTER EDGES. Absolutely NO gold/amber lines across plate faces, no surface crystal veins, no growing spikes, no emissive glow. Bronze rivets and leather straps are the standard fasteners. Show warm resin-dark leather seams.
ANATOMICAL LEFT IS VIEWER RIGHT IN THIS FRONT VIEW. Make:
- HEAD: one low, flat-topped stone cap and short blunt brow visor; open face with both eyes/nose/mouth visible, leather chin strap. No horns, spikes, mask or tall crown. Cap rises no more than about 6cm above the head.
- TORSO: two broad simple upper-chest stone plates, shallow and wearable, ending above flexible abdomen. Grey-brown stone faces, thin bronze/amber OUTER borders, discreet leather support. Abdomen remains cream cloth and leather. Remove the entire short green hooded cape/cloak including shoulder fringe. Do not add a new cape.
- SHOULDERS belong to torso: anatomical LEFT / VIEWER RIGHT is EXACTLY ONE large low slab. Anatomical RIGHT / VIEWER LEFT is EXACTLY TWO slabs: ONE medium above ONE small. These are broad low shells, not upward points. Keep modest clearance, approximately maximum 12cm outward and 8cm upward from shoulder, allowing overhead sword swing. No extra tiny shoulder scales. Do not reverse the asymmetry.
- ARMS: one broad stone forearm outer plate on each arm over leather, LEFT (VIEWER RIGHT) visibly larger; RIGHT smaller. Elbow inside, wrist articulation and all fingers exposed. Keep same natural hands and A-pose.
- WAIST: same belt height and body proportions. Broad leather belt; ONE large LEFT side hip slab (VIEWER RIGHT) and ONE smaller RIGHT slab (VIEWER LEFT), hanging only to mid-thigh. Front stays open, no central rock apron, no long hanging cloth/cords/chains. Retain the existing RIGHT-hip brown pouch clearly visible on VIEWER LEFT. A low small bronze-amber crystal lump is fixed to a shallow plate at the exact back center of the belt, invisible or naturally occluded in this front view; do not move it to the front.
- LEGS: one stone shin plate per shin in front of the original boots, tops BELOW the knees. Knees can bend, original boot toes, sides and straps remain visible. No knee armor or new oversized boots.
All five equipment regions use the original hunter's collar, shoulder seam, bracer top, belt and boot-top boundaries so mixed sets can connect. Do not thicken the underlying body; only add realistic plate thickness. Preserve the same hands, limb lengths and stance.
BACK DESIGN TO MAINTAIN FOR LATER VIEWS: two low flat broad upper-back plates, a FLAT clear central equipment corridor between shoulder blades to waist, no dorsal spikes. The single small low amber cluster belongs to the rear waist plate, not the upper back and never dangling.
Art direction: same grounded semi-realistic 3D game-reference rendering as inputs. The armor must read as Galdros through large rock slabs, a flat rock-cap helmet, and stronger anatomical left shoulder/forearm/hip. One definitive design only. Filename intended: armor_galdros_t2_front_v1.png.

====================
front_refine
====================
Use case: identity-preserve / precise-object-edit. Refine ONLY two small areas of this front-view armor reference. Preserve this exact man, face, pose, limb proportions, hands, boots, entire armor design, plate arrangement, asymmetry, framing, canvas size and ground-contact baseline.
EDIT 1 — helmet: make its upper stone surface LOWER and FLAT, like a broad shallow slab cap with a short blunt brow visor. It must have a horizontal flat crown rather than a rounded/domed helmet. Keep face fully open and the chin strap. Use one simple broad grey-brown rock crown; naturally dark stone cracks are allowed. REMOVE every bronze/amber/gold line crossing the TOP or FRONT FACE of the helmet: the thin bronze-to-amber mineral band belongs ONLY to the helmet's OUTER PERIMETER edge. No central gold seam, no glowing vein, no forehead emblem, no horns, no raised crest. Keep total helmet rise within about 6 cm and preserve the head's position/scale.
EDIT 2 — wrists: shorten the leather bracer extensions on BOTH arms so there is a clearly visible narrow bare-skin wrist articulation gap between bracer and hand. Remove the pointed leather pieces covering the backs of the hands. Keep the stone forearm plates, forearm straps, all exposed fingers and the exact hand positions unchanged. Elbow interiors remain open.
KEEP ABSOLUTELY EVERYTHING ELSE: anatomical LEFT = viewer RIGHT has one large shoulder slab, larger forearm plate and larger hip slab; anatomical RIGHT = viewer LEFT has a medium plus small shoulder slab and the right-hip pouch. Two broad chest plates, flexible cream-cloth abdomen, open-front waist, original boots with below-knee shin plates. Thin bronze/amber borders only at each stone plate's perimeter. No cape, weapons, text, border, dimensions, cast shadow or ground shadow. Single full-body orthographic FRONT on a uniform pale warm grey background. Portrait 1086x1448 or higher with the same framing and proportions. Filename armor_galdros_t2_front_v1.png.

====================
back
====================
Use case: identity-preserve, matching original game armor turnaround.
Create A-2, the exact REAR orthographic view of the SAME tier-2 Galdros armor worn by the SAME hunter in input 1. One figure, one direction.
INPUTS:
1) ARMOR MASTER / SCALE: the completed armor FRONT. Treat every visible plate, leather part, asymmetry and material as fixed.
2) REAR BODY AND POSE TARGET: approved unarmored hunter rear A-pose. Keep his exact underlying body, shoulder/hip/hand/leg landmarks, anatomical proportions, boots and rear hair. Replace clothing only as required by the front armor. Match the front's full-body scale and boot-sole baseline.
3) MONSTER MATERIAL AND REAR-CRYSTAL REFERENCE: Galdros rear. Use only stone character and the little bronze-amber crystal shape; never put the monster into this image.
CAMERA: perfectly straight-on from the BACK, no face visible, no three-quarter turn. Same wide A-pose and arm angles as the supplied hunter rear. The anatomical LEFT is VIEWER LEFT in a rear view; the anatomical RIGHT is VIEWER RIGHT. Do not mirror the front image.
FRAME: portrait 3:4 at least1086x1448, ideally1086x1448. Same character scale, centered and same sole baseline as armor front; full cap to heels inside with modest top/bottom margins. Pale warm-grey PLAIN background, soft even neutral illumination. NO floor, ground/cast shadow, scenery, vignette, text, labels, dimensions, frames, weapons, extra figures.
LOCKED ARMOR DESIGN:
Few broad GREY-BROWN chipped rock slabs about3–4cm thick over worn dark-brown leather and cream heavy cloth. Thin bronze-to-amber mineral rim on each plate's OUTER EDGE ONLY. Stone faces have plain dark mineral cracks and chips, absolutely no amber/gold lines or veins crossing a stone face, no glow, no crystal spikes. Bronze rivets and resin-dark leather seams, same as input1.
- Helmet is the same LOW FLAT stone slab cap as input1. Its top is horizontal, rear cap thin and low over the original brown hair; no tall dome or horns. Bronze rim only around outer edge.
- No hood, no cape, no shoulder fringe.
- Anatomical LEFT / VIEWER LEFT shoulder: exactly ONE large broad low plate, the reverse of the front's large plate, with SAME outline/size/height. Anatomical RIGHT / VIEWER RIGHT shoulder: exactly TWO plates, ONE medium above ONE small. No extra scales. Limits roughly12cm out and8cm up; arms stay freely mobile.
- Upper back: exactly TWO broad shallow flat grey-brown stone panels, one on each side, protecting upper half of back. They are NOT huge shoulder blades, wings, raised ridges or a spine stack. They sit close to the body. The center equipment-support area from between shoulder blades down to waist is FLAT and low-profile: a narrow plain dark-leather junction/flat straps are okay, but no knobs, buckles, raised stones, dorsal spikes or rear weapon. Keep lower back flexible cream cloth/leather and preserve the belt line. All back panel surfaces have only stone-colored cracks, no gold line through faces.
- Forearms: same ONE larger outer LEFT plate and ONE smaller outer RIGHT plate; do not add inner-arm plates just to decorate this view. Inside elbows and narrow wrist joints exposed, no pointed bracer over hands. Exact hands and fingers, viewed from behind.
- Waist: same broad brown belt with ONE large anatomical LEFT hip slab and ONE smaller RIGHT hip slab, hanging only to mid-thigh, sides consistent with front. Preserve original RIGHT-hip pouch, now VIEWER RIGHT, at the exact same location. Keep center-back garment short and practical, no extra long cloth.
- At EXACT center rear of belt/waist: ONE SMALL shallow bronze-amber faceted crystal lump, like the Galdros tail tip in miniature, FIXED directly to a low rear waist plate with small fasteners. About5cm wide, belt-buckle scale, not a large fist-sized jewel; not dangling. This is at the belt level, not on upper back; do not obstruct flat back equipment corridor. It does not emit light. No other rear crystals.
- Same brown trousers and original boots as input1. One front shin plate per leg remains on FRONT of shin: from rear show only naturally visible edges and matching fastening straps, do not invent stone calf armor. Exposed knees, natural heel silhouettes.
Preserve same man and style, exact plate counts and practical attachment logic. Do not redesign by view. A single definitive rear reference. Intended file armor_galdros_t2_back_v1.png.

====================
left
====================
Use case: identity-preserve / consistent game armor turnaround.
Create A-3 LEFT-SIDE orthographic reference of the SAME hunter wearing the SAME tier-2 Galdros armor.
INPUT1: armor FRONT master; all design, anatomical proportions, materials, asymmetry fixed.
INPUT2: armor BACK master; exact rear panels, right-hip pouch and small centered rear-belt crystal are fixed.
INPUT3: approved hunter LEFT-SIDE A-pose is the pose/identity/framing target. Match this exact underlying body and this exact side-view pose; replace apparel with the input1/2 armor, remove the cloak.
Output one full-body strict LEFT PROFILE, face and toes pointing to IMAGE LEFT. We see the hunter's ANATOMICAL LEFT side. This is NOT the right side mirrored. Only the near-side eye is visible. No three-quarter view. Preserve the original A-pose in 3D: in side projection the laterally opened arms are foreshortened exactly as in input3, so do not pose a T or change hand height to a new relaxed pose. Keep the same fingers/hand shape, limb lengths, head and face, original brown boots. Far arm/leg naturally occluded; do not add extra hands or feet.
Frame exactly as the 1086x1448 references, portrait3:4 at least1086x1448, full helmet to soles, same scale and boot contact baseline as front/back. Center figure, small top/bottom margin. Pale warm-grey plain uniform background and neutral soft even lighting. NO floor, ground/cast shadow, scenery, vignette, text, labels, frames, measurements, weapons.
IDENTICAL TIER2 DESIGN, NEVER ADD PLATES:
Grey-brown chipped flat rock, few LARGE slabs over brown leather and cream heavy cloth. Plate thickness about3–4cm, leather underlayer visible. Mineral bronze/amber accent is ONLY a THIN rim around each slab's outer perimeter. Dark stone cracks may cross faces but NO gold/amber surface veins, no emissive glow, no crystal spikes. Preserve the approved shade and texture.
- Helmet: SAME extremely low FLAT slab cap, short blunt visor pointing toward the face/IMAGE LEFT. Flat crown with dark stone cracks only, bronze rim on perimeter only. Open face and chin strap, hair behind ear. No dome, horn or forehead decoration.
- This is the LARGE side: ONE broad large LEFT shoulder plate, matching the outline and dimensions in input1 and2. It has modest outward reach, sits low, and does not rise into a point. Do not turn this into two overlapping left shoulder plates. Right shoulder's medium+small plates remain far-side and are naturally occluded.
- Chest and upper back panels are the SAME two front / two back broad flat panels. In strict profile show their natural edges and attachment thickness, not another full frontal breastplate. The back central plane stays low and flat; no hump, no cape, no hood. Abdomen flexible cream cloth/leather.
- ONE large LEFT outer forearm stone plate on leather. Elbow interior and narrow wrist articulation gap uncovered. No stone covering wrist/knuckles. Keep fingers exposed.
- ONE large LEFT hip plate on the wide belt extending to mid-thigh. Keep front split open. The brown tool pouch belongs to ANATOMICAL RIGHT, the FAR side, so do NOT move it onto the visible left hip. Only natural far-side occlusion is allowed.
- The small single bronze-amber crystal is attached at the exact REAR CENTER belt height, matching input2, and may appear only as a shallow small projection at the back waist silhouette, on IMAGE RIGHT. It is fixed, not dangling; no oversized tail/spike.
- Same single FRONT shin slab per leg with top below knee. In profile reveal only the front-facing slab's true edge/curve, attached on IMAGE LEFT of the shin, with the original leather boot visible behind it. Do not add side/calf rock plates or knee protection. Boots unchanged.
- No long fabric, cords, chains, floating ornaments, additional patterns, or extra armor scales.
Preserve exact front/back plate heights, strap counts and belt line. This is the same one wearable armor set turned90 degrees, not a new variation. Intended filename armor_galdros_t2_left_v1.png.

====================
right
====================
Use case: identity-preserve / same-equipment orthographic turnaround.
Create A-4 RIGHT-SIDE view of the SAME hunter wearing the SAME tier-2 Galdros armor in all references. It must be the actual anatomical RIGHT side, not a mirrored large left side.
Input1: armor front MASTER for identity, armor shapes, sizes, asymmetry and scale.
Input2: armor rear MASTER for back plates, rear belt crystal and RIGHT-hip pouch.
Input3: approved hunter RIGHT-SIDE A-pose, absolute pose/face/limb/body/framing guide. Preserve that man's exact profile and underlying anatomy, change apparel only.
Input4: completed armor LEFT-SIDE, for matching construction depth, overall scale, flat helmet and original boots. Do not copy its large left shoulder/forearm/hip plates onto the right.
CAMERA/POSE: one full-body exact RIGHT PROFILE; face/nose/toes point to IMAGE RIGHT. Only the near right eye visible. Absolutely no three-quarter view. Preserve the same A-pose in3D; its side foreshortening, hand level and arm projection match input3, not a new relaxed stance and not a T-pose. Same man, face, neck, finger count, body thickness and limb lengths. Far-side limbs naturally occluded.
FRAMING: portrait3:4 at least1086x1448, preferably the same1086x1448 as references. Same character height, boot contact line, centered framing and margins as the FRONT armor. Full cap and soles included. Pale warm grey PLAIN background and uniform soft neutral light; no ground/floor/cast shadow, vignette, scenery, weapons, text, labels, dimensions, logos, frames or extra figures.
LOCK DESIGN:
Few large FLAT grey-brown chipped rock slabs3–4cm thick on dark-brown leather and unbleached cream heavy cloth. Same material as inputs. Thin bronze-to-amber mineral edging ONLY around outer plate perimeters. Dark grey/brown stone cracks may occur on the surface, but absolutely NO gold/amber vein lines crossing stone faces, no emissive glow or grown crystal spikes. Bronze rivets and resin-treated leather seams. No cape/hood/fringe.
RIGHT-SIDE CONTENT (smaller side):
- EXACTLY TWO visible RIGHT shoulder stone slabs: one MEDIUM upper slab plus one SMALL lower slab, matching input1/2. They are two separate low overlapping slabs, not a single big pauldron and not three scales. Low broad silhouette, no upward points, no more than about12cm outward/8cm upward.
- ONE SMALLER right outer forearm plate, distinctly smaller than the left forearm plate in input4. Same leather straps. Elbow inner side and narrow wrist joint exposed; fingers and backs of hands unarmored.
- ONE SMALLER right hip plate. Original brown leather tool pouch is on THIS visible anatomical RIGHT hip, exactly at the established belt height, attached over/in front of the upper part of the right hip plate. Show pouch clearly without making a second pouch or moving it to rear-center. Smaller hip plate still visible below/behind it. Plate reaches at most mid-thigh; front waist split stays open.
- Same low FLAT stone-cap helmet with short blunt visor pointing IMAGE RIGHT, open face and leather chin strap. Horizontal low crown, no dome/horns. Bronze line only on cap perimeter; keep crown stone grey-brown with dark cracks, no gold seam across top. No extra neck plates.
- Same two broad chest plates and two shallow flat upper-back panels, in strict profile show their true edges and depth. Flexible abdomen, flat central back equipment-support plane, no hump or dorsal raised parts.
- ONE SMALL bronze-amber faceted crystal lump is fixed at exact rear-center belt/waist, on IMAGE LEFT silhouette if visible, matching rear input2. Keep it low and shallow, belt-buckle scale, not dangling, not glowing.
- Same brown trousers and original brown leather boots. Same single FRONT shin plate below the knee, on IMAGE RIGHT side of shin in this profile. Show slim natural slab depth and fastening straps, no calf/side rock plate, no knee armor. Boot heel/toe sizes unchanged.
The large LEFT shoulder/forearm/hip remain on FAR SIDE and should be naturally occluded, not duplicated onto near side. Preserve all panel numbers and heights, belt and body segment boundaries. No long cloth, cords, chains, extra hanging decorations or new designs. One definitive reference, filename armor_galdros_t2_right_v1.png.


最終調整プロンプト追記
front_surface_fix は修正不十分のため不採用。最終ファイルには front_slab_fix / back_slab_fix / left_slab_fix / right_slab_fix の結果を採用。

====================
front_surface_fix
====================
Precise local color correction ONLY, preserve the entire image pixel composition. This is the finalized front armor view; do not redesign anything.
On the TOP AND FRONT STONE FACE of the flat helmet, remove the thin yellow/bronze/gold crack running near the center-right. In this1086x1448 image it is around x550–575,y82–114. That line must become a DARK GREY-BROWN ordinary rock crack, same nonmetallic color as the surrounding stone. The entire interior surface of the helmet is matte grey-brown rock: no gold, no bronze, no amber veins or internal metallic seams. Keep the existing THIN bronze/amber rim ONLY along the outside perimeter edge at the helmet lip. Do not remove the perimeter rim.
Keep the flat helmet shape, thickness, hair, face, chin strap, and absolutely all other clothing, stones, plate counts, rivets, asymmetry, pose, scale, body, hands, boots, background and framing UNCHANGED. No new lines, parts, labels or shadows. Single1086x1448 portrait front reference.

====================
front_slab_fix
====================
Edit this exact front turnaround image. There is ONE small region to change: the flat rock HELMET ONLY. Keep the silhouette, flat cap outline, thickness, short brow lip, position, skin, hair and leather chin strap exactly as they are.
Replace the ENTIRE visible top/front STONE SURFACE of the helmet with a plain continuous matte grey-brown basalt slab. Its broad top and front stone face must have a subtly grainy, QUIET, mostly smooth stone texture. DELETE EVERY crack, golden vein, polygon outline and yellow line from the entire interior stone face of the helmet. Do not leave even a single yellow crack rising from its rim. The top should clearly read as one solid cut rock slab, NOT a mosaic, NOT a polygon network, NOT metallic.
Retain just ONE thin bronze/amber contour on the outside perimeter lip of the helmet, at its very lowest edge. No other gold or bronze anywhere inside the helmet stone surface.
Do not change ANY other part of the image: same man's face and anatomy, same wide A pose, same shoulder plate counts/asymmetry, same chest armor and all its shapes, same cloth and leather texture, same trousers, pouch, hands, boots, shin plates, scale, margins, background. Do not sharpen or add texture to cloth or leather. No text, weapons, symbols, ground or cast shadow. One full-body orthographic front, exactly 1086 x 1448 portrait. This is a local helmet surface cleanup, NOT a new illustration.

====================
back_slab_fix
====================
Edit this exact full-body back turnaround image. There is ONE small region to change: the flat rock HELMET ONLY. Keep the silhouette, flat cap outline, thickness, short brow lip, position, skin, hair and leather chin strap exactly as they are.
Replace the ENTIRE visible top and side STONE SURFACE of the helmet with a plain continuous matte grey-brown basalt slab. Its broad top and short vertical stone face must have a subtly grainy, QUIET, mostly smooth stone texture. DELETE EVERY crack, golden vein, polygon outline and yellow line from the entire interior stone face of the helmet. Do not leave even a single yellow crack rising from its rim. It should clearly read as one solid cut rock slab, NOT a mosaic, NOT a polygon network, NOT metallic.
Retain just ONE thin bronze/amber contour on the outside perimeter lip of the helmet, at its very lowest edge. No other gold or bronze anywhere inside the helmet stone surface.
Do not change ANY other part of the image: same man's anatomy, same A pose in this orthographic back projection, same shoulder plate counts and asymmetry, same armor and all its shapes, same cloth and leather texture, same straps and flat center back, same rear waist crystal, same trousers and right-hip pouch, same hands, boots, shin plates, scale, ground-contact line, margins and background. Do not sharpen or add texture to cloth or leather. Do not mirror this view. No text, weapons, symbols, ground or cast shadow. One full-body orthographic back, exactly 1086 x 1448 portrait. This is a local helmet surface cleanup, NOT a new illustration.

====================
left_slab_fix
====================
Edit this exact full-body anatomical LEFT side (face pointing toward image left) turnaround image. There is ONE small region to change: the flat rock HELMET ONLY. Keep the silhouette, flat cap outline, thickness, short brow lip, position, skin, hair and leather chin strap exactly as they are.
Replace the ENTIRE visible top and side STONE SURFACE of the helmet with a plain continuous matte grey-brown basalt slab. Its broad top and short vertical stone face must have a subtly grainy, QUIET, mostly smooth stone texture. DELETE EVERY crack, golden vein, polygon outline and yellow line from the entire interior stone face of the helmet. Do not leave even a single yellow crack rising from its rim. It should clearly read as one solid cut rock slab, NOT a mosaic, NOT a polygon network, NOT metallic.
Retain just ONE thin bronze/amber contour on the outside perimeter lip of the helmet, at its very lowest edge. No other gold or bronze anywhere inside the helmet stone surface.
Do not change ANY other part of the image: same man's anatomy, same A pose in this orthographic anatomical LEFT side (face pointing toward image left) projection, same shoulder plate counts and asymmetry, same armor and all its shapes, same cloth and leather texture, same straps and flat center back, same rear waist crystal, same trousers and right-hip pouch, same hands, boots, shin plates, scale, ground-contact line, margins and background. Do not sharpen or add texture to cloth or leather. Do not mirror this view. No text, weapons, symbols, ground or cast shadow. One full-body orthographic anatomical LEFT side (face pointing toward image left), exactly 1086 x 1448 portrait. This is a local helmet surface cleanup, NOT a new illustration.

====================
right_slab_fix
====================
Edit this exact full-body anatomical RIGHT side (face pointing toward image right) turnaround image. There is ONE small region to change: the flat rock HELMET ONLY. Keep the silhouette, flat cap outline, thickness, short brow lip, position, skin, hair and leather chin strap exactly as they are.
Replace the ENTIRE visible top and side STONE SURFACE of the helmet with a plain continuous matte grey-brown basalt slab. Its broad top and short vertical stone face must have a subtly grainy, QUIET, mostly smooth stone texture. DELETE EVERY crack, golden vein, polygon outline and yellow line from the entire interior stone face of the helmet. Do not leave even a single yellow crack rising from its rim. It should clearly read as one solid cut rock slab, NOT a mosaic, NOT a polygon network, NOT metallic.
Retain just ONE thin bronze/amber contour on the outside perimeter lip of the helmet, at its very lowest edge. No other gold or bronze anywhere inside the helmet stone surface.
Do not change ANY other part of the image: same man's anatomy, same A pose in this orthographic anatomical RIGHT side (face pointing toward image right) projection, same shoulder plate counts and asymmetry, same armor and all its shapes, same cloth and leather texture, same straps and flat center back, same rear waist crystal, same trousers and right-hip pouch, same hands, boots, shin plates, scale, ground-contact line, margins and background. Do not sharpen or add texture to cloth or leather. Do not mirror this view. No text, weapons, symbols, ground or cast shadow. One full-body orthographic anatomical RIGHT side (face pointing toward image right), exactly 1086 x 1448 portrait. This is a local helmet surface cleanup, NOT a new illustration.


