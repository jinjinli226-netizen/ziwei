// Shape paths, palette, eyes and deterministic selection reused from DSH Bot ui/avatars.js.
export const AVATAR_SHAPES = [
  { id: "blob", label: "团子" },
  { id: "pebble", label: "卵石" },
  { id: "bean", label: "豆子" },
  { id: "egg", label: "蛋形" },
  { id: "squircle", label: "圆方" },
  { id: "tablet", label: "软糖" },
  { id: "capsule", label: "胶囊" },
  { id: "cylinder", label: "圆柱" },
  { id: "hex", label: "六角" },
  { id: "gem", label: "宝石" },
  { id: "crystal", label: "晶石" },
  { id: "wedge", label: "楔形" },
  { id: "shield", label: "盾形" },
  { id: "dome", label: "圆顶" },
  { id: "arch", label: "拱门" },
  { id: "cloud", label: "云朵" },
  { id: "teardrop", label: "水滴" },
  { id: "leaf", label: "叶片" },
  { id: "square", label: "方块" },
  { id: "sparkle", label: "闪光" },
  { id: "clover", label: "四叶" },
  { id: "flower", label: "花朵" },
  { id: "heart", label: "爱心" },
  { id: "house", label: "小屋" },
  { id: "star", label: "星星" },
];

export const AVATAR_COLORS = [
  { id: "black", label: "黑色", value: "#000000" },
  { id: "brown", label: "棕色", value: "#936439" },
  { id: "red", label: "红色", value: "#FF263C" },
  { id: "orange", label: "橙色", value: "#FF6700" },
  { id: "yellow", label: "黄色", value: "#FF9800" },
  { id: "green", label: "绿色", value: "#00C972" },
  { id: "cyan", label: "青色", value: "#00BCA6" },
  { id: "blue", label: "蓝色", value: "#1084FE" },
  { id: "violet", label: "紫色", value: "#9159FE" },
  { id: "magenta", label: "品红", value: "#FF309B" },
  { id: "gray", label: "灰色", value: "#777777" },
];

const silhouettes = {
  blob: "M50 9C73 8 90 28 90 50C90 72 73 90 50 90C28 90 10 72 10 50C10 29 28 10 50 9Z",
  pebble:
    "M51 10C76 8 91 26 90 53C89 77 72 89 46 88C20 87 8 74 10 49C11 26 27 12 51 10Z",
  bean: "M47 9C65 9 79 21 79 39V65C79 82 68 92 52 92C37 92 26 81 24 65L21 39C19 21 30 9 47 9Z",
  egg: "M51 8C67 8 84 31 86 51C89 75 74 90 51 91C28 92 15 78 15 57C15 35 34 8 51 8Z",
  squircle:
    "M35 11H65C81 11 89 22 89 38V65C89 81 80 90 64 90H36C20 90 11 81 11 65V37C11 21 20 11 35 11Z",
  tablet:
    "M36 20H65C82 20 94 32 94 50C94 68 83 80 65 80H35C17 80 6 68 6 50C6 32 18 20 36 20Z",
  capsule:
    "M50 6C65 6 77 18 77 33V67C77 82 65 94 50 94C35 94 23 82 23 67V33C23 18 35 6 50 6Z",
  cylinder:
    "M15 27C15 17 32 10 51 10C70 10 87 17 87 27V72C87 82 70 90 51 90C32 90 15 82 15 72Z",
  hex: "M35 10Q39 7 43 9L76 27Q80 29 81 34L88 66Q89 71 85 75L62 91Q58 94 53 92L21 75Q17 73 16 68L10 36Q9 31 13 28Z",
  gem: "M32 11C43 6 64 9 77 18C89 27 91 43 86 60C82 75 72 90 61 91C49 92 26 82 17 70C8 58 10 36 17 23C21 17 26 13 32 11Z",
  crystal:
    "M29 7Q32 5 35 7L66 26Q69 28 70 32L78 74Q79 79 76 83L62 94Q59 97 55 94L28 76Q25 74 24 70L16 28Q15 24 18 21Z",
  wedge:
    "M26 10C32 7 39 11 45 16L84 51C96 62 88 74 76 80L29 94C17 97 11 88 14 75L19 24C20 17 21 12 26 10Z",
  shield:
    "M25 11C39 6 62 7 77 11C85 13 88 20 88 29L83 55C79 76 67 92 51 92C35 92 23 76 18 55L12 29C10 20 16 14 25 11Z",
  dome: "M10 58C10 31 28 12 50 12C72 12 90 31 90 58V65Q90 77 79 77H21Q10 77 10 65Z",
  arch: "M50 7C68 7 82 22 82 42V80Q82 90 72 90H28Q18 90 18 80V42C18 22 32 7 50 7Z",
  cloud:
    "M23 25C22 12 39 5 50 13C62 3 81 11 81 27C97 32 96 54 85 62C91 77 76 91 62 86C52 97 34 93 29 84C13 89 2 75 9 61C-1 49 8 29 23 25Z",
  teardrop:
    "M43 7C49 3 57 8 64 15C79 30 88 49 87 64C86 82 72 94 51 94C30 94 15 81 14 62C13 48 21 32 33 15C36 11 40 8 43 7Z",
  leaf: "M35 9C67 8 89 32 88 58C88 72 79 86 67 90C39 94 14 74 13 49C12 34 21 17 35 9Z",
  square: "M24 15H76Q85 15 85 24V76Q85 85 76 85H24Q15 85 15 76V24Q15 15 24 15Z",
  sparkle:
    "M50 3C60 3 65 21 68 30C78 34 96 40 96 50C96 60 78 65 68 69C64 79 60 97 50 97C40 97 35 79 31 69C21 65 4 60 4 50C4 40 21 35 31 30C35 20 40 3 50 3Z",
  clover:
    "M50 15C64 1 85 12 82 31C101 37 96 63 80 67C87 86 67 99 51 87C36 100 15 89 19 71C0 65 1 41 19 35C14 17 35 3 50 15Z",
  flower:
    "M50 13C65 0 83 15 78 31C97 37 95 59 79 67C83 86 62 98 47 86C32 98 12 84 18 67C0 59 5 37 23 32C20 16 36 3 50 13Z",
  heart:
    "M50 22C63 5 88 12 91 32C94 52 70 78 55 91Q50 95 45 91C28 77 7 52 9 33C12 12 37 5 50 22Z",
  house:
    "M39 10Q49 3 59 10L80 28Q85 32 85 39V77Q85 87 75 87H25Q15 87 15 77V39Q15 32 20 28Z",
  star: "M50 5C57 5 60 22 66 26C72 30 88 21 92 29C96 37 81 47 81 54C81 61 97 72 91 79C85 86 71 76 64 79C57 82 57 98 48 98C39 98 38 81 32 77C26 73 10 82 6 74C2 66 18 56 18 49C18 42 3 31 9 24C15 17 28 28 35 24C42 20 42 5 50 5Z",
};
const colorValues = Object.fromEntries(
  AVATAR_COLORS.map(({ id, value }) => [id, value]),
);
const eyePositions = {
  bean: [48, 64, 32, 30],
  egg: [51, 67, 33, 32],
  capsule: [49, 64, 32, 30],
  hex: [50, 67, 33, 32],
  crystal: [36, 51, 37, 35],
  wedge: [36, 53, 44, 44],
  arch: [50, 66, 34, 33],
  cloud: [51, 69, 33, 31],
  teardrop: [51, 66, 37, 35],
  leaf: [52, 69, 35, 34],
  sparkle: [50, 65, 42, 40],
  clover: [51, 69, 34, 32],
  flower: [51, 68, 37, 35],
  house: [51, 67, 37, 36],
  star: [49, 65, 42, 40],
};
export function avatarSpec(bot) {
  const name = typeof bot?.name === "string" ? bot.name : "bot";
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++)
    hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
  const shapeId = AVATAR_SHAPES[hash % AVATAR_SHAPES.length].id;
  const colorId = AVATAR_COLORS[(hash >>> 8) % AVATAR_COLORS.length].id;
  const saved = bot?.metadata?.avatar;
  if (typeof saved === "string") {
    const parts = saved.split(":"),
      [prefix, shape, color] = parts;
    if (
      parts.length === 3 &&
      prefix === "grok" &&
      Object.hasOwn(silhouettes, shape) &&
      Object.hasOwn(colorValues, color)
    )
      return { shapeId: shape, colorId: color };
  }
  return { shapeId, colorId };
}

export function avatarValue(shapeId, colorId) {
  return (
    "grok:" +
    (Object.hasOwn(silhouettes, shapeId) ? shapeId : "blob") +
    ":" +
    (Object.hasOwn(colorValues, colorId) ? colorId : "cyan")
  );
}

export function avatarSvg(shapeId, colorId) {
  const [, shape, color] = avatarValue(shapeId, colorId).split(":");
  // Each SVG is an isolated image; a stable ID also keeps its ETag stable.
  const maskId = "avatar-eyes";
  const [left, right, leftY, rightY] = eyePositions[shape] || [53, 73, 29, 27];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120"><rect x="-10" y="-10" width="120" height="120" fill="white"/><g class="avatar-eyes" fill="black"><rect x="${left}" y="${leftY}" width="8" height="20" rx="4"/><rect x="${right}" y="${rightY}" width="8" height="20" rx="4"/></g></mask></defs><g class="avatar-character" transform="rotate(-20 50 50)"><path class="avatar-body" fill="${colorValues[color]}" d="${silhouettes[shape]}" mask="url(#${maskId})"/></g></svg>`;
}

export function isCharacterAvatar(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts[0] === 'grok' && Object.hasOwn(silhouettes, parts[1]) && Object.hasOwn(colorValues, parts[2]);
}

export function employeeAvatarSrc(value, seed = 'employee') {
  if (value && !isCharacterAvatar(value)) return value;
  const {shapeId, colorId} = avatarSpec({name:seed,metadata:{avatar:value}});
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(avatarSvg(shapeId, colorId));
}
