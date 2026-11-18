"use strict";

function multiplayerWaveDifficulty(wave, totalWaves, playerCount) {
  const targetScale = { 2: 1.7, 3: 2.4, 4: 3.2 }[playerCount] || 1;
  if (targetScale <= 1) return { total: 1, count: 1, hp: 1, speed: 1, bossHp: 1, bossSpeed: 1 };

  const waveProgress = (wave - 1) / Math.max(1, totalWaves - 1);
  const ramp = Math.pow(Math.max(0, (waveProgress - 0.2) / 0.8), 1.35);
  const total = 1 + (targetScale - 1) * ramp;
  const count = Math.sqrt(total);

  return {
    total,
    count,
    hp: total / count,
    speed: 1 + (total - 1) * 0.04,
    bossHp: total,
    bossSpeed: 1 + (total - 1) * 0.03,
  };
}

function damageMob(mob, amount, ownerId) {
  const wasAlive = mob.hp > 0;
  mob.hp -= amount;
  if (wasAlive && mob.hp <= 0) mob.killOwnerId = ownerId || null;
}

function chainTargetsAtLevel(tower, level) {
  if (tower.id === "spark") return Math.min(2, 1 + Math.floor(level / 4));
  if (tower.id === "tesla") return [0, 2, 2, 3, 3, 4][level] || 4;
  return Math.min(4, level);
}

function soldierHpAtLevel(tower, level) {
  if (level < 3) return tower.soldierHp * (1.18 + (level - 1) * 0.16);
  return tower.soldierHp * (1.08 + (level - 3) * 0.035);
}

function towerStatsAtLevel(tower, level, metaLevel) {
  const boost = level - 1;
  const metaBoost = metaLevel - 1;
  const meta = 1 + metaBoost * 0.05;
  const metaRange = 1 + metaBoost * 0.012;
  const metaReload = 1 + metaBoost * 0.018;
  const metaSupportBoost = metaBoost * 0.005;
  const slowingTower = tower.kind === "slow" || tower.kind === "control";
  const slowStep = tower.id === "ice" ? 0.055 : tower.id === "void" ? 0.05 : 0.035;
  const slowCap = tower.id === "ice" ? 0.28 : tower.id === "void" ? 0.25 : 0.22;
  const metaSlowBoost = slowingTower ? metaBoost * 0.005 : 0;
  const blastGrowth = (1 + boost * 0.07) * (slowingTower ? 1 + metaBoost * 0.02 : 1);
  return {
    damage: tower.kind === "support" ? 0 : tower.damage * (1 + boost * 0.36) * meta,
    range: tower.range ? tower.range * (1 + boost * 0.08) * metaRange : 0,
    reload: tower.id === "orbital" || tower.kind === "support"
      ? 0
      : tower.kind === "summon"
        ? Math.ceil((16 - level) / metaReload)
        : tower.fire * (tower.id === "tesla" ? 1.18 : 1) / (1 + level * 0.16) / metaReload + (tower.id === "bank" ? 2 : 0),
    splash: tower.splash ? tower.splash * blastGrowth : 0,
    slow: tower.slow ? Math.max(slowCap, tower.slow - boost * slowStep) - metaSlowBoost : 0,
    poison: tower.poison ? tower.poison * (1 + boost * 0.25) * meta : 0,
    burn: tower.burn ? tower.burn * (1 + boost * 0.25) * meta : 0,
    pierceHits: tower.kind === "pierce" ? 2 + Math.floor(level / 2) : 0,
    chainTargets: tower.kind === "chain" ? chainTargetsAtLevel(tower, level) : 0,
    income: tower.kind === "income" ? Math.round((26 + level * 13) * meta) : 0,
    soldierHp: tower.kind === "summon" ? soldierHpAtLevel(tower, level) * meta : 0,
    soldierDamage: tower.kind === "summon" ? tower.damage * 0.84 * (1 + boost * 0.22) * meta : 0,
    soldierSpeed: tower.kind === "summon" ? tower.soldierSpeed : 0,
    soldierRange: tower.kind === "summon" && level >= 3 ? 90 + boost * 15 : 0,
    soldierReload: tower.kind === "summon" && level >= 3 ? Math.max(0.85, 1.35 - boost * 0.1) : 0,
    fireRateBoost: tower.aura?.fireRate ? tower.aura.fireRate + boost * (tower.aura.fireRateStep || 0.04) + metaSupportBoost : 0,
    damageBoost: tower.aura?.damage ? tower.aura.damage + boost * (tower.aura.damageStep || 0.04) + metaSupportBoost : 0,
    beamDamage: tower.id === "orbital" ? tower.damage * (1 + boost * 0.36) * meta : 0,
  };
}

function supportBonusesForTower(tower, placed, metaLevelForTower) {
  if (tower.kind === "support" || tower.kind === "income") return { fireRate: 1, damage: 1 };
  let fireRate = 1;
  let damage = 1;
  for (const support of placed) {
    if (support.kind !== "support" || support === tower) continue;
    const stats = towerStatsAtLevel(support, support.level, metaLevelForTower(support));
    if (!stats.range || Math.hypot(support.x - tower.x, support.y - tower.y) > stats.range) continue;
    fireRate += stats.fireRateBoost || 0;
    damage += stats.damageBoost || 0;
  }
  return { fireRate, damage };
}

function combatStatsForTower(tower, placed, metaLevelForTower) {
  const stats = towerStatsAtLevel(tower, tower.level, metaLevelForTower(tower));
  if (tower.kind === "support") return stats;
  const bonuses = supportBonusesForTower(tower, placed, metaLevelForTower);
  return {
    ...stats,
    damage: stats.damage * bonuses.damage,
    poison: stats.poison ? stats.poison * bonuses.damage : 0,
    burn: stats.burn ? stats.burn * bonuses.damage : 0,
    reload: tower.id === "orbital" ? 0 : tower.kind === "summon" ? stats.reload : stats.reload / Math.max(0.1, bonuses.fireRate),
    beamDamage: tower.id === "orbital" ? stats.beamDamage * bonuses.damage * bonuses.fireRate : 0,
    soldierDamage: stats.soldierDamage ? stats.soldierDamage * bonuses.damage : 0,
    soldierReload: stats.soldierReload ? stats.soldierReload / Math.max(0.1, bonuses.fireRate) : 0,
  };
}

function moveMob(mob, path, distance) {
  while (distance > 0 && mob.waypoint < path.length) {
    const target = path[mob.waypoint];
    const dx = target[0] - mob.x;
    const dy = target[1] - mob.y;
    const len = Math.hypot(dx, dy);
    if (len <= distance) {
      mob.x = target[0];
      mob.y = target[1];
      mob.waypoint += 1;
      distance -= len;
    } else {
      mob.x += (dx / len) * distance;
      mob.y += (dy / len) * distance;
      distance = 0;
    }
  }
  if (mob.waypoint >= path.length) mob.escaped = true;
}

function pathLength(path) {
  if (Number.isFinite(path.cachedLength)) return path.cachedLength;
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  path.cachedLength = total;
  return total;
}

function pointOnPath(path, progress) {
  let remaining = Math.max(0, Math.min(pathLength(path), progress));
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1];
    const to = path[i];
    const segment = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (remaining <= segment) {
      const ratio = segment ? remaining / segment : 0;
      return {
        x: from[0] + (to[0] - from[0]) * ratio,
        y: from[1] + (to[1] - from[1]) * ratio,
      };
    }
    remaining -= segment;
  }
  const last = path[path.length - 1];
  return { x: last[0], y: last[1] };
}

function calculateMobPathProgress(mob, path) {
  let progress = 0;
  for (let i = 1; i < mob.waypoint; i += 1) {
    progress += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  if (mob.waypoint < path.length) {
    progress += Math.hypot(mob.x - path[mob.waypoint - 1][0], mob.y - path[mob.waypoint - 1][1]);
  }
  return progress;
}

function updateRemoteMobPosition(mob, path, dt, now) {
  if (!Number.isFinite(mob.targetProgress) || !Number.isFinite(mob.displayProgress)) return;
  const elapsed = Number.isFinite(mob.receivedAt)
    ? Math.min(0.12, Math.max(0, (now - mob.receivedAt) / 1000))
    : 0;
  const predictedProgress = mob.targetProgress + (mob.pathVelocity || 0) * elapsed;
  const snap = 1 - Math.exp(-dt * 30);
  mob.displayProgress += (predictedProgress - mob.displayProgress) * snap;
  const point = pointOnPath(path, mob.displayProgress);
  mob.x = point.x;
  mob.y = point.y;
}

function midGamePressure(wave, totalWaves) {
  const start = Math.max(4, Math.round(totalWaves * 0.32));
  const end = Math.max(start + 2, Math.round(totalWaves * 0.72));
  if (wave < start || wave > end) return { count: 1, hp: 1, speed: 1 };
  const middle = (start + end) / 2;
  const halfRange = Math.max(1, (end - start) / 2);
  const centerStrength = 1 - Math.min(1, Math.abs(wave - middle) / halfRange);
  const pressure = 0.45 + centerStrength * 0.55;
  return { count: 1 + pressure * 0.14, hp: 1 + pressure * 0.18, speed: 1 + pressure * 0.045 };
}

function lateStageBossHpScale(stage) {
  if (stage < 10) return 1;
  return { 10: 0.82, 11: 0.76, 12: 0.7, 13: 0.67, 14: 0.65, 15: 0.65 }[stage] || 0.65;
}

function earlyStagePressure(stage) {
  if (stage >= 1 && stage <= 3) return { count: 1.4, spacing: 0.7, bossHp: 1.55 };
  if (stage === 4) return { count: 1, spacing: 1, bossHp: 1.25 };
  if (stage === 5) return { count: 1, spacing: 1, bossHp: 1.16 };
  return { count: 1, spacing: 1, bossHp: 1 };
}

function stageEase(stage) {
  return stage >= 4
    ? { count: 0.95, hp: 0.95, speed: 0.98, spacing: 1.03 }
    : { count: 1, hp: 1, speed: 1, spacing: 1 };
}

function baseMobHpForStage(stage) {
  const earlyStageScale = stage >= 1 && stage <= 4 ? 1.12 : 1;
  return (14 + stage * 5) * earlyStageScale;
}

function waveHealthScale(stage, wave, totalWaves, tier = null) {
  const progress = (wave - 1) / Math.max(1, totalWaves - 1);
  const ramp = Math.pow(progress, 1.65);
  const stageGrowth = 1 + ramp * (2.25 + stage * 0.12);
  const tierGrowth = tier === null ? 1 : 1 + ramp * (0.28 + tier * 0.04) / 0.78;
  const previousScale = stageGrowth * midGamePressure(wave, totalWaves).hp * tierGrowth;
  return 1 + (previousScale - 1) * 0.8;
}

function longestPathIndex(paths) {
  let best = 0;
  for (let i = 1; i < paths.length; i += 1) {
    if (pathLength(paths[i]) > pathLength(paths[best])) best = i;
  }
  return best;
}

function createWaveSpawns(level, wave, playerCount, monsterForSpawn) {
  const GLOBAL_STAGE_DIFFICULTY = { hp: 1.08, speed: 1.05, spacing: 0.98 };
  const spawns = [];
  const waveProgress = (wave - 1) / Math.max(1, level.waves - 1);
  const waveRamp = Math.pow(waveProgress, 1.65);
  const coopScale = multiplayerWaveDifficulty(wave, level.waves, playerCount);
  const midPressure = midGamePressure(wave, level.waves);
  const stage = level.id;
  const ease = stageEase(stage);
  const earlyPressure = earlyStagePressure(stage);
  const startCount = stage >= 10 ? 10 : 5;
  const finalExtra = 36 + stage * 2 + Math.floor(level.waves / 5) * 5;
  let count = startCount + Math.round((finalExtra * waveRamp) / 5) * 5;
  count = Math.ceil((count * coopScale.count * midPressure.count) / 5) * 5;
  if (wave === 1 && stage >= 10) count = Math.max(6, Math.floor(count * 0.6));
  count = Math.ceil(count * earlyPressure.count * ease.count);
  const baseHp = baseMobHpForStage(stage);
  const waveHpScale = waveHealthScale(stage, wave, level.waves);
  const speed = (37 + stage * 0.85 + waveRamp * (16 + stage * 0.7)) * midPressure.speed * 1.08 * GLOBAL_STAGE_DIFFICULTY.speed * ease.speed;
  const spacing = Math.min(1.5, 1 + waveRamp * 0.3 + Math.max(0, stage - 1) * 0.012) * earlyPressure.spacing * GLOBAL_STAGE_DIFFICULTY.spacing * ease.spacing;
  const stagePressure = 1 + Math.min(0.08, Math.max(0, (stage - 1) * 0.006));
  const hp = baseHp * stagePressure * coopScale.hp * GLOBAL_STAGE_DIFFICULTY.hp * ease.hp;
  const stageCountScale = stage === 15 ? 0.92 : 1;
  const stageBossScale = 4.2 + stage * 0.18;
  const bossHpScale = lateStageBossHpScale(stage) * earlyPressure.bossHp;
  const pathCount = level.paths.length;
  const pathSpawnCounts = Array(pathCount).fill(0);
  let lastSpawnTime = 0;
  for (let i = 0; i < count; i += 1) {
    const pathIndex = pathCount > 1 ? i % pathCount : 0;
    const spawnTime = pathSpawnCounts[pathIndex] * spacing;
    pathSpawnCounts[pathIndex] += 1;
    lastSpawnTime = Math.max(lastSpawnTime, spawnTime);
    const monster = monsterForSpawn(i);
    const heavy = monster.shape === "brute" || monster.shape === "armored";
    const tier = monster.tier || 0;
    const monsterHpScale = monster.hp * 0.78;
    const monsterWaveHpScale = waveHealthScale(stage, wave, level.waves, tier);
    const monsterSpeedScale = 1 + (monster.speed - 1) * (0.7 + waveRamp * 0.25);
    const monsterBaseDamage = Math.max(1, Math.round(monster.damage * (0.75 + waveRamp * 0.55)));
    spawns.push({
      t: spawnTime,
      pathIndex,
      hp: hp * monsterWaveHpScale * monsterHpScale * stageCountScale,
      speed: speed * coopScale.speed * monsterSpeedScale,
      reward: Math.round((9 + Math.floor(stage * 1.5)) * monster.reward * (1 + waveRamp * 0.4)),
      baseDamage: monsterBaseDamage,
      boss: false,
      heavy,
      monster,
    });
  }
  if (wave === level.waves) {
    const boss = level.boss;
    spawns.push({
      t: lastSpawnTime + 10,
      pathIndex: longestPathIndex(level.paths),
      hp: baseHp * waveHpScale * (7.5 + stage * 0.48) * stagePressure * stageBossScale * coopScale.bossHp * 1.8 * bossHpScale * GLOBAL_STAGE_DIFFICULTY.hp,
      speed: speed * 0.56 * coopScale.bossSpeed,
      reward: (10 + Math.floor(stage * 1.5)) * 15,
      baseDamage: 5 + Math.floor(stage / 5),
      boss: true,
      heavy: false,
      bossName: boss.name,
      bossColor: boss.color,
      monster: null,
    });
  }
  return spawns;
}

function monsterForSpawn(level, wave, index) {
  const monsters = level.monsters || [];
  const waveRatio = (wave - 1) / Math.max(1, level.waves - 1);
  if (!monsters.length) {
    return { name: "Creep", color: "#303942", edge: "#aeb8bf", eye: "#ff5b55", hp: 1, speed: 1, damage: 1, reward: 1, shape: "normal" };
  }
  const activeCount = Math.min(monsters.length, 2 + Math.floor(waveRatio * 6));
  const activeMonsters = monsters.slice(0, activeCount);
  const advancedChance = Math.min(0.84, 0.08 + waveRatio * 0.68);
  const eliteChance = Math.min(0.34, Math.max(0, (waveRatio - 0.5) * 0.62));
  const seed = index + wave * 41 + level.id * 97;
  const roll = Math.abs(Math.sin(seed * 127.1 + 1201 * 311.7) * 43758.5453) % 1;
  if (roll < eliteChance) {
    const elitePool = activeMonsters.slice(Math.max(0, activeMonsters.length - 3));
    return elitePool[index % elitePool.length];
  }
  if (roll < advancedChance) return activeMonsters[(index + wave) % activeMonsters.length];
  return activeMonsters[index % Math.min(2, activeMonsters.length)];
}

globalThis.IroncladSimulationRules = {
  multiplayerWaveDifficulty, damageMob, towerStatsAtLevel, supportBonusesForTower, combatStatsForTower,
  moveMob, pathLength, pointOnPath, calculateMobPathProgress,
  updateRemoteMobPosition,
  midGamePressure, lateStageBossHpScale, earlyStagePressure, stageEase, baseMobHpForStage, waveHealthScale, createWaveSpawns, monsterForSpawn,
};
