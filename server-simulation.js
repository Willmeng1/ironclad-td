import { readFileSync } from "node:fs";
import "./simulation-rules.js";

const rules = globalThis.IroncladSimulationRules;
const data = JSON.parse(readFileSync(new URL("./simulation-data.json", import.meta.url), "utf8"));
const towerTypes = new Map(data.towers.map((tower) => [tower.id, tower]));
const MAX_ACTIVE_SHOTS = 90;

export function towerDefinition(id) {
  return towerTypes.get(id);
}

function resistanceFactor(mob, type) {
  return 1 - Math.min(0.5, Math.max(0, mob.resistances?.[type] || 0));
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

export function createSimulation(stageId, options = {}) {
  const level = structuredClone(data.levels[stageId - 1]);
  if (!level) throw new Error("Invalid stage");
  const emit = options.emit || (() => {});
  const state = {
    currentLevel: level, wave: 0, runningWave: false, ended: false, baseHp: level.baseHp,
    placed: [], mobs: [], soldiers: [], shots: [], spawns: [], kills: 0, nextMobId: 1,
    earnedXp: 0, earnedGems: 0, playerCount: options.playerCount || 1,
  };
  let nextShotId = 1;
  const playerMeta = options.playerMeta || (() => 1);
  const statsFor = (tower) => rules.combatStatsForTower(tower, state.placed, (item) => playerMeta(item.ownerId, item.id));
  const pathFor = (mob) => level.paths[mob.pathIndex];
  const progressOf = (mob) => Number.isFinite(mob.progress) ? mob.progress : rules.calculateMobPathProgress(mob, pathFor(mob));
  const distanceToBase = (mob) => Math.max(0, rules.pathLength(pathFor(mob)) - progressOf(mob));
  const addShot = (shot) => {
    shot.networkId = `server-${nextShotId++}`;
    shot.maxLife ||= shot.life;
    state.shots.push(shot);
  };

  function spawn(spawnInfo) {
    const monster = spawnInfo.monster;
    const path = level.paths[spawnInfo.pathIndex];
    state.mobs.push({
      uid: state.nextMobId++, x: path[0][0], y: path[0][1], hp: spawnInfo.hp, maxHp: spawnInfo.hp,
      speed: spawnInfo.speed, reward: spawnInfo.reward * (spawnInfo.boss ? 3 : 1),
      baseDamage: spawnInfo.baseDamage, pathIndex: spawnInfo.pathIndex, waypoint: 1,
      slowTimer: 0, slowFactor: 1, dot: 0, poisonTimer: 0, burnTimer: 0, shockTimer: 0,
      shockColor: "#65ffe4", voidTimer: 0, boss: spawnInfo.boss, heavy: spawnInfo.heavy,
      monsterName: monster?.name, monsterColor: monster?.color, monsterEdge: monster?.edge,
      monsterEye: monster?.eye, monsterShape: monster?.shape || "normal",
      resistances: spawnInfo.boss ? { kinetic: 0.1, elemental: 0.1, energy: 0.1 } : data.resistances[monster?.name] || {},
      bossName: spawnInfo.bossName, bossColor: spawnInfo.bossColor,
    });
  }

  function applyDamage(tower, target, stats) {
    const damageType = data.attackTypes[tower.id]?.toLowerCase() || "kinetic";
    const damageTo = (mob, amount, type = damageType) => rules.damageMob(mob, amount * resistanceFactor(mob, type), tower.ownerId);
    const affected = stats.splash ? state.mobs.filter((mob) => Math.hypot(mob.x - target.x, mob.y - target.y) <= stats.splash) : [target];
    if (stats.splash) affected.forEach((mob) => damageTo(mob, stats.damage));
    else {
      damageTo(target, stats.damage);
      if (stats.pierceHits > 1) {
        let hits;
        if (tower.id === "rail") {
          const dx = target.x - tower.x, dy = target.y - tower.y, length = Math.hypot(dx, dy) || 1;
          const nx = dx / length, ny = dy / length, endX = tower.x + nx * stats.range, endY = tower.y + ny * stats.range;
          hits = state.mobs.filter((mob) => mob !== target && mob.hp > 0)
            .map((mob) => ({ mob, projection: (mob.x - tower.x) * nx + (mob.y - tower.y) * ny, lineDistance: distanceToSegment(mob.x, mob.y, tower.x, tower.y, endX, endY) }))
            .filter(({ projection, lineDistance }) => projection > 18 && projection <= stats.range + 12 && lineDistance <= 24)
            .sort((a, b) => a.projection - b.projection).slice(0, stats.pierceHits - 1);
        } else {
          const targetProgress = progressOf(target);
          hits = state.mobs.filter((mob) => mob !== target && mob.pathIndex === target.pathIndex && mob.hp > 0)
            .map((mob) => ({ mob, progress: progressOf(mob) }))
            .filter(({ progress }) => progress < targetProgress && targetProgress - progress <= 110)
            .sort((a, b) => b.progress - a.progress).slice(0, stats.pierceHits - 1);
        }
        hits.forEach(({ mob }, index) => damageTo(mob, stats.damage * Math.max(0.55, 0.85 - index * 0.1)));
      }
    }
    if (stats.slow) affected.forEach((mob) => { mob.slowTimer = 1.8; mob.slowFactor = mob.boss ? 1 - (1 - stats.slow) * 0.5 : stats.slow; });
    if (stats.poison || stats.burn) affected.forEach((mob) => {
      mob.dot += (stats.poison || stats.burn) * resistanceFactor(mob, "elemental");
      mob.dotOwnerId = tower.ownerId || null;
      if (stats.poison) mob.poisonTimer = Math.max(mob.poisonTimer || 0, 2.8);
      if (stats.burn) mob.burnTimer = Math.max(mob.burnTimer || 0, 2.4);
    });
    if (tower.id === "void") affected.forEach((mob) => { mob.voidTimer = Math.max(mob.voidTimer || 0, 2.1); });
    if (tower.kind === "chain") {
      const color = tower.id === "spark" ? "#b98cff" : "#65ffe4";
      const draw = state.shots.length < MAX_ACTIVE_SHOTS * 0.55 && state.mobs.length < 90;
      target.shockTimer = Math.max(target.shockTimer || 0, draw ? 0.24 : 0.1);
      target.shockColor = color;
      const jumps = state.mobs.filter((mob) => mob !== target && mob.hp > 0 && Math.hypot(mob.x - target.x, mob.y - target.y) <= 75)
        .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))
        .slice(0, stats.chainTargets);
      let source = target;
      let active = state.shots.filter((shot) => shot.style === "chainLightning" || shot.style === "chainTesla").length;
      jumps.forEach((mob, index) => {
        const scale = tower.id === "tesla" ? Math.max(0.12, 0.44 - index * 0.07) : Math.max(0.2, 0.4 - index * 0.05);
        damageTo(mob, stats.damage * scale);
        mob.shockTimer = Math.max(mob.shockTimer || 0, draw ? 0.24 : 0.1);
        mob.shockColor = color;
        if (draw && index < 2 && state.shots.length < MAX_ACTIVE_SHOTS && active < 12) {
          const life = tower.id === "tesla" ? 0.16 : 0.14;
          addShot({ x: source.x, y: source.y, tx: mob.x, ty: mob.y, color: tower.color, life, style: tower.id === "tesla" ? "chainTesla" : "chainLightning", width: tower.id === "tesla" ? 2 : 1.6 });
          active++;
        }
        source = mob;
      });
    }
  }

  const anchors = { dart: [28, -24], ice: [-1, -59], spark: [0, -51], sniper: [-29, -20], venom: [0, -45], bank: [-2, -57], tesla: [0, -50], ember: [1, -48], barracks: [1, -43], void: [0, -45], ranger: [-25, -38], rail: [-26, -17], orbital: [0, -49] };
  const styles = { dart: ["arrow", 0.24, 3], ice: ["ice", 0.28, 4], spark: ["lightning", 0.12, 2], tesla: ["tesla", 0.13, 2.5], sniper: ["bullet", 0.18, 2.5], rail: ["rail", 0.18, 5], venom: ["poison", 0.3, 5], ember: ["fire", 0.3, 6], void: ["void", 0.32, 5], ranger: ["ranger", 0.18, 3] };

  function updateTower(tower, dt) {
    if (tower.kind === "support") return;
    if ((tower.kind === "income" || tower.kind === "summon") && (!state.runningWave || state.wave < 1)) return;
    tower.cooldown -= dt;
    const stats = statsFor(tower);
    if (tower.kind === "summon" && tower.cooldown <= 0) {
      const existing = state.soldiers.filter((soldier) => soldier.owner === tower).length;
      const pathIndex = (tower.spawnPathIndex || 0) % level.paths.length;
      tower.spawnPathIndex = (tower.spawnPathIndex || 0) + 1;
      const path = level.paths[pathIndex], progress = Math.max(0, rules.pathLength(path) - 8 - existing * 12);
      const point = rules.pointOnPath(path, progress);
      state.soldiers.push({ owner: tower, visualLevel: tower.level, ...point, pathIndex, progress, hp: stats.soldierHp, maxHp: stats.soldierHp, damage: stats.soldierDamage, speed: stats.soldierSpeed, range: stats.soldierRange, reload: stats.soldierReload, cooldown: 0, color: tower.color });
      addShot({ ...point, tx: point.x, ty: point.y, color: tower.color, life: 0.45, style: "spawn", radius: 24 });
      tower.cooldown = stats.reload;
      return;
    }
    if (tower.kind === "income" && tower.cooldown <= 0) {
      emit("income", { ownerId: tower.ownerId, amount: stats.income });
      const [x, y] = anchors.bank;
      addShot({ x: tower.x + x, y: tower.y + y, tx: tower.x + x, ty: tower.y + y, color: tower.color, life: 0.42, style: "coinPulse", radius: 26 });
      tower.cooldown = stats.reload;
      return;
    }
    if (tower.id !== "orbital" && tower.cooldown > 0) return;
    let target = null;
    let bestDistance = Infinity;
    const rangeSq = stats.range * stats.range;
    for (const mob of state.mobs) {
      if (mob.hp <= 0) continue;
      const dx = mob.x - tower.x, dy = mob.y - tower.y;
      if (dx * dx + dy * dy > rangeSq) continue;
      const distance = distanceToBase(mob);
      if (distance < bestDistance) { target = mob; bestDistance = distance; }
    }
    if (!target) return;
    const [ox, oy] = anchors[tower.id] || [0, -16];
    if (tower.id === "orbital") {
      rules.damageMob(target, stats.beamDamage * dt, tower.ownerId);
      const life = Math.max(0.04, dt + 0.02);
      addShot({ x: tower.x + ox, y: tower.y + oy, tx: target.x, ty: target.y, color: tower.color, life, style: "orbital", beam: true, width: 4.5 });
      return;
    }
    tower.cooldown = stats.reload;
    const [style, life, width] = styles[tower.id] || [tower.kind || "basic", 0.16, 3];
    const shot = { x: tower.x + ox, y: tower.y + oy, tx: target.x, ty: target.y, color: tower.color, radius: stats.splash || 0, style, life, width };
    if (tower.id === "rail") Object.assign(shot, { impactTarget: target, impactTower: tower, impactStats: stats, impactLife: life * 0.3 });
    else applyDamage(tower, target, stats);
    addShot(shot);
  }

  function updateSoldiers(dt) {
    for (const soldier of state.soldiers) {
      soldier.cooldown -= dt;
      const collision = state.mobs.filter((mob) => mob.hp > 0).map((mob) => {
        const screenDistance = Math.hypot(mob.x - soldier.x, mob.y - soldier.y);
        let distance = Infinity;
        if (mob.pathIndex === soldier.pathIndex) {
          const current = progressOf(mob), previous = Number.isFinite(mob.prevProgress) ? mob.prevProgress : current;
          const crossed = previous <= soldier.progress + 10 && current >= soldier.progress - 10;
          const along = crossed ? 0 : Math.abs(current - soldier.progress);
          if (along <= 34) distance = along;
        } else if (screenDistance <= 30) distance = screenDistance;
        return { mob, distance };
      }).filter((item) => Number.isFinite(item.distance)).sort((a, b) => a.distance - b.distance)[0]?.mob;
      const collide = (mob) => {
        addShot({ x: soldier.x, y: soldier.y, tx: mob.x, ty: mob.y, color: soldier.color, life: 0.18, style: "melee", radius: 18 });
        const damage = soldier.hp * (mob.boss ? 0.9 : 1);
        if (damage >= mob.hp) { soldier.hp -= mob.hp; rules.damageMob(mob, mob.hp, soldier.owner?.ownerId); }
        else { rules.damageMob(mob, damage, soldier.owner?.ownerId); soldier.hp = 0; }
      };
      if (collision) { collide(collision); continue; }
      const candidates = state.mobs.filter((mob) => mob.hp > 0 && (soldier.range ? Math.hypot(mob.x - soldier.x, mob.y - soldier.y) <= soldier.range : mob.pathIndex === soldier.pathIndex));
      candidates.sort((a, b) => soldier.range ? distanceToBase(a) - distanceToBase(b) : Math.abs(progressOf(a) - soldier.progress) - Math.abs(progressOf(b) - soldier.progress));
      const target = candidates[0];
      const move = () => {
        const path = level.paths[soldier.pathIndex];
        soldier.progress = Math.max(0, Math.min(rules.pathLength(path), soldier.progress - soldier.speed * dt));
        Object.assign(soldier, rules.pointOnPath(path, soldier.progress));
      };
      if (!target) { move(); continue; }
      const distance = progressOf(target) - soldier.progress;
      if (soldier.range && Math.hypot(target.x - soldier.x, target.y - soldier.y) <= soldier.range) {
        if (soldier.cooldown <= 0) {
          rules.damageMob(target, soldier.damage * 0.55 * (target.boss ? 0.9 : 1), soldier.owner?.ownerId);
          soldier.cooldown = soldier.reload;
          addShot({ x: soldier.x + 21, y: soldier.y - 7, tx: target.x, ty: target.y, color: soldier.color, life: 0.12, width: 2, style: "soldier" });
        }
      } else if (distance < -18) move();
      else if (distance <= 18 && soldier.cooldown <= 0) { collide(target); soldier.cooldown = 0.55; }
    }
    state.soldiers = state.soldiers.filter((soldier) => soldier.hp > 0 && soldier.progress > 0.5);
  }

  function step(dt) {
    if (state.ended) return;
    state.spawns.forEach((item) => { item.t -= dt; });
    const ready = state.spawns.filter((item) => item.t <= 0);
    state.spawns = state.spawns.filter((item) => item.t > 0);
    ready.forEach(spawn);
    for (const mob of state.mobs) {
      mob.prevX = mob.x; mob.prevY = mob.y; mob.prevProgress = progressOf(mob);
      if (mob.dot > 0) { rules.damageMob(mob, Math.min(mob.dot * dt, mob.hp), mob.dotOwnerId); mob.dot = Math.max(0, mob.dot - 14 * dt); }
      mob.slowTimer -= dt;
      for (const key of ["poisonTimer", "burnTimer", "shockTimer", "voidTimer"]) mob[key] = Math.max(0, (mob[key] || 0) - dt);
      rules.moveMob(mob, pathFor(mob), mob.speed * (mob.slowTimer > 0 ? mob.slowFactor : 1) * dt);
      mob.progress = rules.calculateMobPathProgress(mob, pathFor(mob));
    }
    const escaped = state.mobs.filter((mob) => mob.escaped);
    if (escaped.length) {
      if (escaped.some((mob) => mob.boss)) state.baseHp = 0;
      else {
        const damage = escaped.reduce((sum, mob) => sum + Math.max(1, Math.ceil(mob.baseDamage * (mob.maxHp ? Math.max(0, Math.min(1, mob.hp / mob.maxHp)) : 1))), 0);
        state.baseHp = state.wave === 1 ? Math.max(1, state.baseHp - damage) : state.baseHp - damage;
      }
      state.mobs = state.mobs.filter((mob) => !mob.escaped);
      if (state.baseHp <= 0) { state.ended = true; emit("result", { result: "lost" }); return; }
    }
    state.placed.forEach((tower) => updateTower(tower, dt));
    updateSoldiers(dt);
    const impacts = [];
    state.shots = state.shots.filter((shot) => {
      if (shot.impactTarget && state.mobs.includes(shot.impactTarget) && shot.impactTarget.hp > 0) { shot.tx = shot.impactTarget.x; shot.ty = shot.impactTarget.y; }
      shot.life -= dt;
      if (shot.impactTarget && !shot.impacted && shot.life <= shot.impactLife) { shot.impacted = true; impacts.push(shot); }
      return shot.life > 0;
    });
    impacts.forEach((shot) => { if (state.mobs.includes(shot.impactTarget) && shot.impactTarget.hp > 0) applyDamage(shot.impactTower, shot.impactTarget, shot.impactStats); });
    if (state.shots.length > MAX_ACTIVE_SHOTS) state.shots.splice(0, state.shots.length - MAX_ACTIVE_SHOTS);
    const dead = state.mobs.filter((mob) => mob.hp <= 0);
    if (dead.length) {
      state.kills += dead.length;
      state.earnedXp += dead.reduce((sum, mob) => sum + mob.baseDamage * 2, 0) / 3;
      for (const mob of dead) { emit("kill", { ownerId: mob.killOwnerId, amount: mob.reward, mob }); }
      state.mobs = state.mobs.filter((mob) => mob.hp > 0);
    }
    if (state.runningWave && !state.spawns.length && !state.mobs.length) {
      state.runningWave = false;
      state.earnedGems += Math.max(1, Math.floor(level.rewardGems / level.waves));
      state.earnedXp += Math.max(1, Math.floor(level.rewardXp / level.waves));
      emit("waveEnd", { wave: state.wave, bonus: 75 + state.wave * 15 });
      if (state.wave >= level.waves) { state.ended = true; emit("result", { result: "won" }); }
    }
  }

  function snapshot() {
    return {
      simTime: performance.now(), baseHp: state.baseHp, wave: state.wave, runningWave: state.runningWave,
      kills: state.kills, earnedXp: state.earnedXp, earnedGems: state.earnedGems,
      towerStates: state.placed.map((tower) => ({ uid: tower.uid, cooldown: tower.cooldown })),
      mobs: state.mobs.map((mob) => ({ ...mob })), spawns: state.spawns.map((spawnInfo) => ({ ...spawnInfo })),
      soldiers: state.soldiers.map(({ owner, ...soldier }) => ({ ...soldier, ownerUid: owner?.uid })),
      shots: state.shots.map(({ impactTarget, impactTower, impactStats, ...shot }) => shot),
    };
  }

  function startWave() {
    if (state.runningWave || state.ended || state.wave >= level.waves) return false;
    state.wave++;
    state.runningWave = true;
    state.spawns = rules.createWaveSpawns(level, state.wave, state.playerCount, (index) => rules.monsterForSpawn(level, state.wave, index));
    return true;
  }

  function placeTower(placed) {
    const type = towerTypes.get(placed.type);
    if (!type) return false;
    state.placed.push({ ...type, ...placed, cooldown: 0 });
    return true;
  }

  return { state, step, snapshot, startWave, placeTower };
}
