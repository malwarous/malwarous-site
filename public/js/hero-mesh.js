/* ==========================================================================
   Malwarous — hero-mesh.js
   The live intrusion topology in the homepage hero.

   A slowly rotating mesh of nodes and links, with packets moving along the
   edges. The pointer disturbs the nearest nodes; clicking a node starts a
   breach that propagates along the graph and then heals.

   Everything here is optional. If motion is off, the screen is small or
   canvas is missing, the static ASCII fallback stays visible.
   ========================================================================== */

(function () {
  'use strict';

  var canvas = document.querySelector('[data-mesh-canvas]');
  if (!canvas) return;

  var stage = canvas.closest('[data-mesh-stage]');
  if (!stage) return;

  var context = canvas.getContext('2d');
  if (!context) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var largeScreen = window.matchMedia('(min-width: 1024px)');
  if (reducedMotion) return;

  var root = document.documentElement;
  var nodesEl = document.querySelector('[data-mesh-nodes]');
  var rateEl = document.querySelector('[data-mesh-rate]');
  var stateEl = document.querySelector('[data-mesh-state]');
  var TAU = Math.PI * 2;

  var colors = { tint: '#9D90FF', live: '#F2A93B', critical: '#E5484D', muted: '#8B8A93' };
  var width = 0;
  var height = 0;
  var dpr = 1;
  var cx = 0;
  var cy = 0;
  var radius = 1;

  var NODE_COUNT = 86;
  var nodes = [];
  var edges = [];
  var adjacency = [];
  var screen = [];
  var packets = [];
  var ripples = [];

  var mouse = { x: -9999, y: -9999, nx: 0, ny: 0, active: false, hover: -1 };
  var breach = { active: false, start: 0, origin: -1, hops: null, duration: 3800 };
  var raf = null;
  var last = 0;
  var elapsed = 0;
  var visible = true;
  var packetClock = 0;
  var rateClock = 0;
  var packetsDone = 0;

  function readColors() {
    var styles = getComputedStyle(root);
    colors.tint = styles.getPropertyValue('--brand-tint').trim() || colors.tint;
    colors.live = styles.getPropertyValue('--live').trim() || colors.live;
    colors.critical = styles.getPropertyValue('--critical').trim() || colors.critical;
    colors.muted = styles.getPropertyValue('--muted').trim() || colors.muted;
  }

  function hexFor(index) {
    return '0x' + (0x100 + index * 37).toString(16).slice(-3).toUpperCase();
  }

  function buildTopology() {
    nodes = [];
    edges = [];
    packets = [];
    screen = [];
    adjacency = [];

    // Fibonacci sphere: even coverage without a random clump.
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < NODE_COUNT; i++) {
      var y = 1 - (i / (NODE_COUNT - 1)) * 2;
      var ring = Math.sqrt(Math.max(0, 1 - y * y));
      var angle = golden * i;
      nodes.push({
        x: Math.cos(angle) * ring,
        y: y,
        z: Math.sin(angle) * ring,
        seed: Math.random() * TAU,
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0,
        hex: hexFor(i)
      });
      screen.push({ x: 0, y: 0, z: 0, scale: 1 });
      adjacency.push([]);
    }

    // Each node links to its two closest neighbours. Distances are measured
    // on the unit sphere, so the graph stays stable while the mesh rotates.
    var seen = {};
    for (var a = 0; a < NODE_COUNT; a++) {
      var nearest = [];
      for (var b = 0; b < NODE_COUNT; b++) {
        if (a === b) continue;
        var dx = nodes[a].x - nodes[b].x;
        var dy = nodes[a].y - nodes[b].y;
        var dz = nodes[a].z - nodes[b].z;
        nearest.push([dx * dx + dy * dy + dz * dz, b]);
      }
      nearest.sort(function (first, second) { return first[0] - second[0]; });
      for (var k = 0; k < 2; k++) {
        var other = nearest[k][1];
        var low = Math.min(a, other);
        var high = Math.max(a, other);
        var key = low + ':' + high;
        if (seen[key]) continue;
        seen[key] = true;
        edges.push([low, high]);
        adjacency[low].push(high);
        adjacency[high].push(low);
      }
    }

    if (nodesEl) nodesEl.textContent = String(NODE_COUNT);
    setState('secure', false);
  }

  function size() {
    var rect = stage.getBoundingClientRect();
    width = Math.max(220, rect.width);
    height = Math.max(320, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = width / 2;
    cy = height / 2;
    radius = Math.min(width, height) * 0.38;
  }

  function project(node) {
    var rotateY = elapsed * 0.16 + (mouse.active ? mouse.nx * 0.32 : 0);
    var tilt = -0.2 + (mouse.active ? mouse.ny * 0.22 : Math.sin(elapsed * 0.24) * 0.06);
    var cosY = Math.cos(rotateY);
    var sinY = Math.sin(rotateY);
    var cosX = Math.cos(tilt);
    var sinX = Math.sin(tilt);

    var x = node.x * cosY - node.z * sinY;
    var z = node.x * sinY + node.z * cosY;
    var y = node.y * cosX - z * sinX;
    z = node.y * sinX + z * cosX;

    // A tiny breath keeps the surface alive when the pointer is still.
    x += Math.sin(elapsed * 0.7 + node.seed) * 0.008;
    y += Math.cos(elapsed * 0.6 + node.seed) * 0.008;

    var perspective = 2.35;
    var scale = perspective / (perspective - z * 0.6);
    return {
      x: cx + x * radius * scale,
      y: cy + y * radius * scale,
      z: z,
      scale: scale
    };
  }

  function bfs(origin) {
    var hops = new Array(NODE_COUNT).fill(-1);
    if (origin < 0) return hops;
    hops[origin] = 0;
    var queue = [origin];
    while (queue.length) {
      var current = queue.shift();
      for (var i = 0; i < adjacency[current].length; i++) {
        var next = adjacency[current][i];
        if (hops[next] !== -1) continue;
        hops[next] = hops[current] + 1;
        queue.push(next);
      }
    }
    return hops;
  }

  function nearestNode(x, y) {
    var best = -1;
    var bestDistance = 32 * 32;
    for (var i = 0; i < screen.length; i++) {
      var dx = screen[i].x - x;
      var dy = screen[i].y - y;
      var distance = dx * dx + dy * dy;
      if (screen[i].z > -0.72 && distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  function setState(text, breachMode) {
    if (!stateEl) return;
    stateEl.textContent = text;
    stateEl.classList.toggle('is-breach', Boolean(breachMode));
  }

  function spawnPacket() {
    if (!edges.length) return;
    var edge = edges[Math.floor(Math.random() * edges.length)];
    var reverse = Math.random() < 0.5;
    packets.push({
      a: reverse ? edge[1] : edge[0],
      b: reverse ? edge[0] : edge[1],
      t: 0,
      speed: 0.35 + Math.random() * 0.55
    });
  }

  function updateScreen(dt) {
    // Project every node, then let the pointer push the closest ones aside.
    for (var i = 0; i < NODE_COUNT; i++) {
      var projected = project(nodes[i]);
      screen[i].x = projected.x;
      screen[i].y = projected.y;
      screen[i].z = projected.z;
      screen[i].scale = projected.scale;

      var node = nodes[i];
      if (mouse.active) {
        var dx = screen[i].x + node.ox - mouse.x;
        var dy = screen[i].y + node.oy - mouse.y;
        var distanceSq = dx * dx + dy * dy;
        if (distanceSq < 150 * 150 && distanceSq > 0.01) {
          var distance = Math.sqrt(distanceSq);
          var force = (1 - distance / 150) * 0.85;
          node.vx += (dx / distance) * force;
          node.vy += (dy / distance) * force;
        }
      }

      node.vx += -node.ox * 0.055;
      node.vy += -node.oy * 0.055;
      node.vx *= 0.88;
      node.vy *= 0.88;
      node.ox += node.vx;
      node.oy += node.vy;

      var offset = Math.sqrt(node.ox * node.ox + node.oy * node.oy);
      if (offset > 26) {
        node.ox *= 26 / offset;
        node.oy *= 26 / offset;
      }

      screen[i].x += node.ox;
      screen[i].y += node.oy;
    }
  }

  function draw(dt, now) {
    context.clearRect(0, 0, width, height);
    var appear = Math.min(1, elapsed / 1.1);

    updateScreen(dt);

    // Hover: the nearest node under the pointer, if it is close enough.
    mouse.hover = -1;
    if (mouse.active) {
      mouse.hover = nearestNode(mouse.x, mouse.y);
    }

    var wave = breach.active ? ((now - breach.start) / 1000) * 9 : -1;
    if (breach.active && now - breach.start > breach.duration) {
      breach.active = false;
      breach.hops = null;
      setState('secure', false);
      wave = -1;
    }

    var compromised = new Array(NODE_COUNT);
    for (var n = 0; n < NODE_COUNT; n++) {
      compromised[n] = Boolean(
        breach.active &&
        breach.hops &&
        breach.hops[n] >= 0 &&
        breach.hops[n] <= wave
      );
    }

    // Edges. Depth decides the brightness; a breach turns the affected path red.
    context.lineWidth = 1;
    for (var e = 0; e < edges.length; e++) {
      var from = edges[e][0];
      var to = edges[e][1];
      var a = screen[from];
      var b = screen[to];
      var depth = (a.z + b.z) / 2;
      var alpha = (0.11 + (depth + 1) * 0.13) * appear;
      var color = colors.tint;

      if (compromised[from] && compromised[to]) {
        color = colors.critical;
        alpha = 0.52;
      } else if (from === mouse.hover || to === mouse.hover) {
        color = colors.live;
        alpha = 0.62;
      }

      context.globalAlpha = alpha;
      context.strokeStyle = color;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }

    // Packets travel along the edges.
    packetClock += dt;
    while (packetClock > 90) {
      packetClock -= 90;
      if (packets.length < 46) spawnPacket();
    }

    for (var p = packets.length - 1; p >= 0; p--) {
      var packet = packets[p];
      packet.t += (packet.speed * dt) / 1000;
      if (packet.t >= 1) {
        packets.splice(p, 1);
        packetsDone++;
        continue;
      }
      var start = screen[packet.a];
      var end = screen[packet.b];
      var px = start.x + (end.x - start.x) * packet.t;
      var py = start.y + (end.y - start.y) * packet.t;
      var tailT = Math.max(0, packet.t - 0.1);
      var tx = start.x + (end.x - start.x) * tailT;
      var ty = start.y + (end.y - start.y) * tailT;

      context.globalAlpha = 0.28 * appear;
      context.strokeStyle = colors.live;
      context.beginPath();
      context.moveTo(tx, ty);
      context.lineTo(px, py);
      context.stroke();

      context.globalAlpha = 0.9 * appear;
      context.fillStyle = colors.live;
      context.beginPath();
      context.arc(px, py, 1.3, 0, TAU);
      context.fill();
    }

    // Nodes, back to front so the near ones sit on top.
    var order = [];
    for (var o = 0; o < NODE_COUNT; o++) order.push(o);
    order.sort(function (first, second) { return screen[first].z - screen[second].z; });

    for (var q = 0; q < order.length; q++) {
      var index = order[q];
      var point = screen[index];
      var depth01 = (point.z + 1) / 2;
      var nodeRadius = 1.1 + depth01 * 1.7;
      var nodeColor = colors.tint;
      var nodeAlpha = (0.25 + depth01 * 0.7) * appear;

      if (compromised[index]) {
        nodeColor = colors.critical;
        nodeAlpha = 0.95;
        nodeRadius += 0.7;
      }
      if (index === mouse.hover) {
        nodeColor = colors.live;
        nodeAlpha = 1;
        nodeRadius += 1.8;
      }

      context.globalAlpha = nodeAlpha;
      context.fillStyle = nodeColor;
      if (compromised[index] || index === mouse.hover) {
        context.shadowColor = nodeColor;
        context.shadowBlur = 9;
      }
      context.beginPath();
      context.arc(point.x, point.y, nodeRadius, 0, TAU);
      context.fill();
      context.shadowBlur = 0;

      if (index === mouse.hover) {
        context.globalAlpha = 0.7;
        context.strokeStyle = colors.live;
        context.beginPath();
        context.arc(point.x, point.y, nodeRadius + 5, 0, TAU);
        context.stroke();

        context.globalAlpha = 0.95;
        context.fillStyle = colors.live;
        context.font = '10px "JetBrains Mono", monospace';
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(nodes[index].hex, point.x + 12, point.y - 9);
        context.globalAlpha = 0.55;
        context.fillStyle = colors.muted;
        context.fillText('probe', point.x + 12, point.y + 4);
      }
    }

    // Breach: an expanding ring at the entry point.
    if (breach.active && breach.origin >= 0) {
      var origin = screen[breach.origin];
      var age = (now - breach.start) / 1000;
      var ringRadius = age * radius * 1.5;
      context.globalAlpha = Math.max(0, 0.55 - age * 0.14);
      context.strokeStyle = colors.critical;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(origin.x, origin.y, ringRadius, 0, TAU);
      context.stroke();
      context.globalAlpha = Math.max(0, 0.25 - age * 0.06);
      context.beginPath();
      context.arc(origin.x, origin.y, ringRadius * 0.72, 0, TAU);
      context.stroke();
    }

    // Click ripples (also shown when the click misses a node).
    for (var r = ripples.length - 1; r >= 0; r--) {
      var ripple = ripples[r];
      ripple.radius += (70 * dt) / 1000;
      ripple.life -= dt / 900;
      if (ripple.life <= 0) { ripples.splice(r, 1); continue; }
      context.globalAlpha = ripple.life * 0.4;
      context.strokeStyle = colors.live;
      context.beginPath();
      context.arc(ripple.x, ripple.y, ripple.radius, 0, TAU);
      context.stroke();
    }

    // A slow scanline keeps the surface feeling monitored.
    var sweep = ((elapsed * 34) % (height + 160)) - 80;
    context.globalAlpha = 0.08;
    context.fillStyle = colors.tint;
    context.fillRect(0, sweep, width, 1);
    context.globalAlpha = 0.018;
    context.fillRect(0, sweep - 46, width, 46);

    context.globalAlpha = 1;

    // Packet telemetry, once a second.
    rateClock += dt;
    if (rateClock >= 1000) {
      if (rateEl) rateEl.textContent = String(packetsDone);
      packetsDone = 0;
      rateClock = 0;
    }
  }

  function frame(now) {
    var dt = Math.min(40, now - last || 16);
    last = now;
    elapsed += dt / 1000;

    if (breach.active && now - breach.start > breach.duration) {
      breach.active = false;
      breach.hops = null;
      setState('secure', false);
    }

    draw(dt, now);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf !== null || !visible || document.hidden || !largeScreen.matches) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf === null) return;
    cancelAnimationFrame(raf);
    raf = null;
  }

  function breachAt(x, y) {
    updateScreen(0);
    var origin = nearestNode(x, y);
    if (origin < 0) {
      // Missed the mesh: still answer the click with a scan ripple.
      ripples.push({ x: x, y: y, radius: 0, life: 1 });
      return;
    }
    breach.active = true;
    breach.start = performance.now();
    breach.origin = origin;
    breach.hops = bfs(origin);
    ripples.push({ x: screen[origin].x, y: screen[origin].y, radius: 0, life: 1 });
    setState('breach', true);
  }

  function localPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  stage.addEventListener('pointermove', function (event) {
    var point = localPoint(event);
    mouse.x = point.x;
    mouse.y = point.y;
    mouse.nx = (point.x / width - 0.5) * 2;
    mouse.ny = (point.y / height - 0.5) * 2;
    mouse.active = true;
  }, { passive: true });

  stage.addEventListener('pointerleave', function () {
    mouse.active = false;
    mouse.hover = -1;
  });

  stage.addEventListener('pointerdown', function (event) {
    var point = localPoint(event);
    mouse.x = point.x;
    mouse.y = point.y;
    mouse.active = true;
    breachAt(point.x, point.y);
  });

  window.addEventListener('malwarous:theme', readColors);
  window.addEventListener('resize', size, { passive: true });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () { size(); }).observe(stage);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible = entry.isIntersecting;
        if (visible) start(); else stop();
      });
    }, { threshold: 0.02 }).observe(stage);
  }

  if (typeof largeScreen.addEventListener === 'function') {
    largeScreen.addEventListener('change', function (event) {
      if (event.matches) start(); else stop();
    });
  }

  readColors();
  buildTopology();
  size();
  stage.classList.add('is-live');
  start();
})();
