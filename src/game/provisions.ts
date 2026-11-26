/** 里で作る携帯食・道具。原作名・配合は複製しない。 */
export const PROVISIONS = [
  {
    "id": "meal_stew",
    "name": "里の狩人汁",
    "output": "item.hunter_stew",
    "count": 1,
    "money": 30,
    "materials": [
      {
        "itemId": "mat.fish.streamfin",
        "count": 1
      },
      {
        "itemId": "mat.gather.flatnagi_leaf",
        "count": 1
      }
    ]
  },
  {
    "id": "grill_meat",
    "name": "焼き肉を作る",
    "output": "item.roast_meat",
    "count": 1,
    "money": 10,
    "materials": [
      {
        "itemId": "item.raw_meat",
        "count": 1
      }
    ]
  },
  {
    "id": "heal_mix",
    "name": "回復液を調合",
    "output": "item.heal_tonic",
    "count": 1,
    "money": 10,
    "materials": [
      {
        "itemId": "mat.gather.flatnagi_leaf",
        "count": 1
      }
    ]
  },
  {
    "id": "flash_mix",
    "name": "白光玉を調合",
    "output": "item.flash_orb",
    "count": 1,
    "money": 30,
    "materials": [
      {
        "itemId": "mat.gather.dewbreak_fruit",
        "count": 1
      },
      {
        "itemId": "mat.ore.basin_iron",
        "count": 1
      }
    ]
  },
  {
    "id": "cool_mix",
    "name": "涼息液を調合",
    "output": "item.cool_tonic",
    "count": 1,
    "money": 15,
    "materials": [
      {
        "itemId": "mat.gather.flatnagi_leaf",
        "count": 1
      },
      {
        "itemId": "mat.gather.dewbreak_fruit",
        "count": 1
      }
    ]
  },
  {
    "id": "warm_mix",
    "name": "温息液を調合",
    "output": "item.warm_tonic",
    "count": 1,
    "money": 15,
    "materials": [
      {
        "itemId": "mat.gather.dewbreak_fruit",
        "count": 2
      }
    ]
  }
] as const;
