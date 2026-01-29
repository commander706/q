export const Weapons = [
  {
    name: "PISTOL",
    fireRate: 5.2,     // shots/sec
    damage: 14,
    spread: 0.010,
    magSize: 12,
    reserve: 48,
  },
  {
    name: "SMG",
    fireRate: 12.5,
    damage: 7,
    spread: 0.020,
    magSize: 28,
    reserve: 84,
  },
  {
    name: "SHOTGUN",
    fireRate: 1.3,
    damage: 8,
    pellets: 8,
    spread: 0.070,
    magSize: 6,
    reserve: 24,
  },
  {
    name: "SNIPER",
    fireRate: 0.9,
    damage: 55,
    spread: 0.002,
    magSize: 5,
    reserve: 15,
  },
];

export function makeWeaponState() {
  return {
    lastShot: 0,
    mag: Weapons.map((w) => w.magSize),
    reserve: Weapons.map((w) => w.reserve),
  };
}
