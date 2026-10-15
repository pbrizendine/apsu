const lock = document.querySelector('.lock');
const pick = document.querySelector('.pick');
const keyhole = document.querySelector('.keyhole');
const ring = document.querySelector('.progress-ring');
const roundSections = document.querySelectorAll('.round-progress');
const leftButton = document.querySelector('.turn-button-left');
const rightButton = document.querySelector('.turn-button-right');
const tryButton = document.querySelector('.try-button');
const result = document.querySelector('.result');
const attemptNumber = document.querySelector('.attempt-number');
const attemptFill = document.querySelector('.attempt-fill');
result.setAttribute('aria-live', 'polite');

const pickControls = document.querySelector('.pick-controls');
const attemptCounter = document.querySelector('.attempt-counter');

const itemParams = new URLSearchParams(window.location.search);
let toolItems;

try {
  toolItems = JSON.parse(itemParams.get('picks') || '[]');
} catch {
  toolItems = [];
}
if (!Array.isArray(toolItems)) toolItems = [];

toolItems = toolItems
  .filter((item) => item && typeof item.id === 'string' && [50, 100].includes(item.capacity))
  .slice(0, 3);
const hasPick = toolItems.length > 0;
let selectedPick = 0;
let itemCapacity = toolItems[0]?.capacity || 0;
let reportedDamage = itemCapacity <= 50;
let keyInserted = false;
let keyFinished = false;
const hasKey = itemParams.get('key') === '1';

const levelNames = ['Easy', 'Moderate', 'Hard'];
const tolerances = [20, 10, 5];
const attemptLimits = [15, 10, 7]; // Attempts available in each third.
const damageRates = [20, 40, 45]; // Health lost per second: Easy, Moderate, Hard.

// Presets remain available to each door; players cannot change difficulty here.
const presetIndex = levelNames.findIndex(
  (name) => name.toLowerCase() === (itemParams.get('difficulty') || 'moderate').toLowerCase(),
);
const configuredLevel = presetIndex < 0 ? 2 : presetIndex + 1;

const turnSpeed = 60; // Degrees per second.
const holdDuration = 4; // Seconds to complete each round.
const totalRounds = 3;

let currentLevel = 1;
let targetAngle = 0;
let tolerance = 20;
let pickAngle = 0;
let health = 100;
let ranOutOfAttempts = false;
let redWarning = false;
let failurePopped = false;
let shards = [];
let progress = 0;
let strain = 0;
let holding = false;
let opened = false;
let unlockTime = 0;
let unlockRotation = 0;
let ringBounce;
let completedRounds = 0;
let waitingForRelease = false;

let leftHeld = false;
let rightHeld = false;
let spaceHeld = false;
let mouseDirection = 0;
let mouseTrying = false;
let previousTime = performance.now();

let inserted = false;
let attemptsLeft = 15;
let attemptActive = false;
let snapping = false;
let dragPointer = null;
let pickX = 0;
let pickY = 0;
let targetX = 0;
let targetY = 0;
let grabX = 0;
let grabY = 0;
let dragAngle = 0;
let previousPointerAngle = 0;
let grabDistance = 0;
let manualPush = 0;
let manualTrying = false;
let pushDepth = 0;

function pointerDistance(event) {
  const hole = keyhole.getBoundingClientRect();
  return Math.hypot(
    event.clientX - (hole.left + hole.right) / 2,
    event.clientY - (hole.top + hole.bottom) / 2,
  );
}

function pointerAngle(event) {
  const hole = keyhole.getBoundingClientRect();
  const x = event.clientX - (hole.left + hole.right) / 2;
  const y = event.clientY - (hole.top + hole.bottom) / 2;

  return (Math.atan2(x, -y) * 180) / Math.PI;
}

function returnPickToCorner() {
  targetX = window.innerWidth - 18 - selectedPick * 24;
  targetY = Math.max(24, window.innerHeight - 224);
}

function stopDragging() {
  if (dragPointer !== null && pick.hasPointerCapture(dragPointer)) {
    pick.releasePointerCapture(dragPointer);
  }

  dragPointer = null;
  pick.classList.remove('dragging');
  keyhole.classList.remove('drop-ready');
  manualPush = 0;
  if (manualTrying) {
    manualTrying = false;
    finishAttempt();
  }
}

function pickTouchesKeyhole() {
  const hole = keyhole.getBoundingClientRect();
  const pickBounds = pick.getBoundingClientRect();
  // Compare the visible pick and hole, rather than the cursor.
  return (
    pickBounds.right >= hole.left &&
    pickBounds.left <= hole.right &&
    pickBounds.bottom >= hole.top &&
    pickBounds.top <= hole.bottom
  );
}

pick.addEventListener('pointerdown', function (event) {
  if (
    keyInserted ||
    opened ||
    snapping ||
    health <= 0 ||
    event.button !== 0 ||
    dragPointer !== null
  )
    return;
  if (inserted && (spaceHeld || mouseTrying)) return;

  event.preventDefault();
  dragPointer = event.pointerId;
  grabX = event.clientX - pickX;
  grabY = event.clientY - pickY;
  targetX = pickX;
  targetY = pickY;
  pick.setPointerCapture(dragPointer);
  pick.classList.add('dragging');
  if (inserted) {
    dragAngle = pickAngle;
    previousPointerAngle = pointerAngle(event);
    grabDistance = pointerDistance(event);
  }
});

pick.addEventListener('pointermove', function (event) {
  if (event.pointerId !== dragPointer) return;
  if (inserted) {
    if (opened || health <= 0) return;
    // Moving toward the hole pushes the pick in, up to 24 pixels.

    manualPush = Math.max(0, Math.min(24, grabDistance - pointerDistance(event)));
    if (!manualTrying && manualPush >= 12 && beginAttempt(true)) {
      manualTrying = true;
    } else if (manualTrying && manualPush <= 6) {
      manualTrying = false;
      finishAttempt();
      dragAngle = pickAngle;
    }

    const angle = pointerAngle(event);
    // Use the change in angle so grabbing never makes the pick jump.
    const change = ((angle - previousPointerAngle + 540) % 360) - 180;

    if (!manualTrying) dragAngle = Math.max(-90, Math.min(90, dragAngle + change));

    previousPointerAngle = angle;

    return;
  }

  targetX = event.clientX - grabX;
  targetY = event.clientY - grabY;
});

pick.addEventListener('pointerup', function (event) {
  if (event.pointerId !== dragPointer) return;
  if (inserted) {
    stopDragging();
    return;
  }

  const droppedInHole = pickTouchesKeyhole();
  stopDragging();
  if (droppedInHole) {
    snapping = true;
  } else {
    returnPickToCorner();
  }
});

pick.addEventListener('pointercancel', function () {
  stopDragging();
  if (!inserted) returnPickToCorner();
});

window.addEventListener('resize', function () {
  if (!inserted && !snapping) {
    stopDragging();
    returnPickToCorner();
  }
});

function drawPick(offset) {
  if (!inserted) {
    pick.style.clipPath = 'none';
    pick.style.left = pickX + 'px';
    pick.style.top = pickY + 'px';
    pick.style.transform = opened ? 'rotate(' + pickAngle + 'deg)' : 'none';
    if (dragPointer !== null) {
      keyhole.classList.toggle('drop-ready', pickTouchesKeyhole());
    }

    return;
  }
  // Keep the pick visible over the hole. Only its far edges hide it.

  const angle = ((pickAngle + offset - unlockRotation) * Math.PI) / 180;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  // The hole is 20 by 100. Leave the incoming side unrestricted.
  const left = sine > 0 ? -10 : -1000;
  const right = sine < 0 ? 10 : 1000;
  const top = cosine < 0 ? -50 : -1000;
  const bottom = cosine >= 0 ? 50 : 1000;
  const corners = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  // Convert the hole's edges into the rotated pick's coordinates.
  pick.style.clipPath =
    'polygon(' +
    corners
      .map(function (point) {
        const x = 3 + cosine * point[0] + sine * point[1];
        const y = 200 - pushDepth - sine * point[0] + cosine * point[1];
        return x + 'px ' + y + 'px';
      })
      .join(', ') +
    ')';
  pick.style.transform =
    'translateX(-50%) rotate(' + (pickAngle + offset) + 'deg) translateY(' + pushDepth + 'px)';
}

function clearShards() {
  for (const shard of shards) {
    shard.animation.cancel();
    shard.element.remove();
  }

  shards = [];
}

function shatterPick() {
  if (!inserted) return;

  const angle = (pickAngle * Math.PI) / 180;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  // Do not create pieces from the part hidden past the hole's edge.
  const edge = Math.min(10 / Math.abs(sine), 50 / Math.abs(cosine));
  const visibleEnd = 200 - Math.max(0, pushDepth - edge);

  for (let start = 0; start < visibleEnd; start += 25) {
    const height = Math.min(25, visibleEnd - start);
    const distance = 200 - pushDepth - start - height / 2;
    const piece = document.createElement('div');
    piece.className = 'pick-shard';
    piece.setAttribute('aria-hidden', 'true');
    piece.style.height = height + 'px';
    piece.style.left = 'calc(50% + ' + (sine * distance - 3) + 'px)';
    piece.style.top = 125 - cosine * distance - height / 2 + 'px';
    lock.appendChild(piece);

    const scatter = (Math.random() - 0.5) * 110;
    const spin = (Math.random() - 0.5) * 240;
    const animation = piece.animate(
      [
        { transform: 'rotate(' + pickAngle + 'deg)', opacity: 1 },
        {
          transform:
            'translate(' + scatter * 0.4 + 'px, -15px) rotate(' + (pickAngle + spin * 0.4) + 'deg)',
          opacity: 1,
          offset: 0.35,
        },
        {
          transform: 'translate(' + scatter + 'px, 100px) rotate(' + (pickAngle + spin) + 'deg)',
          opacity: 0,
        },
      ],
      { duration: 650, easing: 'linear', fill: 'forwards' },
    );
    animation.onfinish = function () {
      piece.remove();
    };
    shards.push({ element: piece, animation: animation });
  }
}

function drawRing() {
  if (attemptNumber.textContent !== String(attemptsLeft)) {
    attemptNumber.textContent = String(attemptsLeft);
    attemptNumber.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  const remaining = attemptsLeft / attemptLimits[currentLevel - 1];
  attemptFill.style.width = remaining * 100 + '%';
  attemptNumber.style.color = 'var(--color-900)';

  // The red tint grows as health falls from 50 to zero.
  let damage = !hasPick || ranOutOfAttempts ? 0 : Math.max(0, (50 - health) / 50);
  // Fade the warning away over the first 0.2 seconds of unlocking.

  if (opened) damage *= Math.max(0, 1 - unlockTime / 0.2);

  lock.style.setProperty('--damage', damage * 100 + '%');
  if (damage > 0 && !redWarning) {
    lock.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
      { duration: 240, easing: 'ease-out' },
    );
  }

  redWarning = damage > 0;
  for (let round = 0; round < totalRounds; round++) {
    let fill = 0;
    let color = 'gold';

    if (round < completedRounds) {
      fill = 1;
      color = 'limegreen';
    } else if (round === completedRounds) {
      fill = progress;
    }

    if (hasPick && health <= 0) {
      fill = 1;
      color = 'crimson';
      if (!failurePopped) {
        roundSections[round].animate(
          [{ strokeWidth: '10px' }, { strokeWidth: '16px' }, { strokeWidth: '10px' }],
          { duration: 260, easing: 'ease-out' },
        );
      }
    }

    // Show more of this section's solid stroke as progress increases.
    roundSections[round].setAttribute('stroke-dasharray', fill * 116 + ' 360');
    roundSections[round].style.stroke = color;
  }

  if (hasPick && health <= 50 && !reportedDamage) {
    reportedDamage = true;
    itemCapacity = 50;
    toolItems[selectedPick].capacity = 50;
    window.parent.postMessage(
      { type: 'apsu-lockpick-damaged', itemId: toolItems[selectedPick]?.id },
      '*',
    );
  }
  if (hasPick && health <= 0 && !failurePopped) {
    shatterPick();
    failurePopped = true;
    window.parent.postMessage(
      { type: 'apsu-lockpick-broken', itemId: toolItems[selectedPick]?.id },
      '*',
    );
  }

  const showPickControls = inserted && !keyInserted;
  pickControls.style.visibility = showPickControls ? 'visible' : 'hidden';
  attemptCounter.style.visibility = showPickControls ? 'visible' : 'hidden';

  ring.setAttribute(
    'aria-valuenow',
    Math.round(((completedRounds + progress) / totalRounds) * 100),
  );
  ring.setAttribute(
    'aria-valuetext',
    opened ? 'Lock opened' : 'Round ' + (completedRounds + 1) + ' of 3',
  );
  document.body.style.setProperty(
    '--pick-color',
    itemCapacity <= 50 ? '#E8A0AA' : 'var(--metal-tool)',
  );
  pick.style.visibility = keyInserted || health <= 0 ? 'hidden' : 'visible';
  leftButton.disabled =
    rightButton.disabled =
    tryButton.disabled =
      !inserted || opened || health <= 0;
}

function resetInputs() {
  stopDragging();
  snapping = false;
  if (!inserted) returnPickToCorner();

  leftHeld = false;
  rightHeld = false;
  spaceHeld = false;
  mouseDirection = 0;
  mouseTrying = false;
  finishAttempt();
  holding = false;
  waitingForRelease = false;
  strain = 0;
  if (!opened) {
    progress = 0;
  }

  drawPick(0);
  drawRing();
}

function startLevel(level) {
  clearShards();
  currentLevel = level;
  tolerance = tolerances[level - 1];
  targetAngle = Math.floor(Math.random() * 181) - 90;
  pickAngle = 0;
  pushDepth = 0;
  health = itemCapacity;
  ranOutOfAttempts = false;
  redWarning = false;
  failurePopped = false;
  progress = 0;
  opened = false;
  unlockTime = 0;
  unlockRotation = 0;
  if (ringBounce) ringBounce.cancel();

  keyhole.style.transform = 'rotate(0deg)';
  completedRounds = 0;
  attemptsLeft = attemptLimits[level - 1];
  attemptActive = false;
  inserted = false;
  pick.classList.add('loose');
  pick.title = 'Lockpick';
  returnPickToCorner();
  pickX = targetX;
  pickY = targetY;
  resetInputs();
}

function chooseNextTarget() {
  const possibleAngles = [];

  for (let angle = -90; angle <= 90; angle++) {
    // Move the zone away from both the old zone and the current pick.
    if (Math.abs(angle - targetAngle) > tolerance * 2 && Math.abs(angle - pickAngle) > tolerance) {
      possibleAngles.push(angle);
    }
  }

  const index = Math.floor(Math.random() * possibleAngles.length);
  targetAngle = possibleAngles[index];
}

// The browser calls this before each new animation frame.
function updateGame(now) {
  const seconds = (now - previousTime) / 1000;
  previousTime = now;
  let offset = 0;

  if (opened && !keyFinished && unlockTime < 0.6) {
    unlockTime = Math.min(unlockTime + seconds, 0.6);
    let rotation;

    if (unlockTime < 0.18) {
      // Ease into a small rightward wind-up.
      const t = unlockTime / 0.18;
      rotation = 8 * (1 - (1 - t) * (1 - t));
    } else {
      // Squaring the time makes the left turn accelerate.
      const t = (unlockTime - 0.18) / 0.42;
      rotation = 8 - 98 * t * t;
    }
    if (inserted) pickAngle += rotation - unlockRotation;

    unlockRotation = rotation;
    keyhole.style.transform = 'rotate(' + rotation + 'deg)';
    // Let the pick leave halfway through the unlock animation.
    if (inserted && unlockTime >= 0.3) {
      const hole = keyhole.getBoundingClientRect();
      pickX = (hole.left + hole.right) / 2 - 3;
      pickY = (hole.top + hole.bottom) / 2 - 200;
      pickX -= Math.sin((pickAngle * Math.PI) / 180) * pushDepth;
      pickY += Math.cos((pickAngle * Math.PI) / 180) * pushDepth;
      pushDepth = 0;
      stopDragging();
      inserted = false;
      pick.classList.add('loose');
      pick.title = 'Lockpick';
      returnPickToCorner();
    }
    if (unlockTime >= 0.6) {
      ringBounce = ring.animate(
        [
          { transform: 'scale(1)', offset: 0 },
          { transform: 'scale(1.10)', offset: 0.25 },
          { transform: 'scale(0.98)', offset: 0.55 },
          { transform: 'scale(1.025)', offset: 0.78 },
          { transform: 'scale(1)', offset: 1 },
        ],
        { duration: 520, easing: 'ease-in-out' },
      );
    }
  }

  if (!inserted) {
    if (snapping) {
      // Align the pick's bottom with the center of the keyhole.
      const hole = keyhole.getBoundingClientRect();
      targetX = (hole.left + hole.right) / 2 - 3;
      targetY = (hole.top + hole.bottom) / 2 - 200;
    }
    // Follow the pointer with a small delay for a little weight.

    const follow = 1 - Math.exp(-(opened ? 5 : snapping ? 14 : 22) * seconds);
    pickX += (targetX - pickX) * follow;
    pickY += (targetY - pickY) * follow;
    if (opened) pickAngle += (0 - pickAngle) * follow;

    if (snapping && Math.abs(targetX - pickX) < 0.5 && Math.abs(targetY - pickY) < 0.5) {
      inserted = true;
      window.parent.postMessage(
        { type: 'apsu-lockpick-inserted', itemId: toolItems[selectedPick]?.id },
        '*',
      );
      pick.classList.remove('loose');
      pick.style.left = '';
      pick.style.top = '';
      pick.title = 'Lockpick';
      resetInputs();
    }
  }

  if (inserted && !opened && health > 0) {
    if (!spaceHeld && !mouseTrying && !manualTrying) waitingForRelease = false;

    holding = (spaceHeld || mouseTrying || manualTrying) && !waitingForRelease;

    if (holding) {
      // Zero means anywhere inside the valid zone.
      const distance = Math.max(Math.abs(pickAngle - targetAngle) - tolerance, 0);
      const limit = Math.max(0, 1 - distance / 90);

      // Easy takes damage after stalling; Moderate and Hard immediately off-target.
      const timeToLimit = Math.max(0, (limit - progress) * holdDuration);
      progress = Math.min(limit, progress + seconds / holdDuration);

      if (distance > 0) {
        const stuckTime = Math.max(0, seconds - timeToLimit);
        strain += stuckTime;
        const damageTime = currentLevel === 1 ? stuckTime : seconds;
        health = Math.max(0, health - damageTime * damageRates[currentLevel - 1]);
      }

      const strength = Math.min(distance / 10 + strain * 3, 15);
      offset = (Math.random() * 2 - 1) * strength;

      if (progress >= 1) {
        // Briefly thicken the section that just turned green.
        roundSections[completedRounds].animate(
          [{ strokeWidth: '10px' }, { strokeWidth: '16px' }, { strokeWidth: '10px' }],
          { duration: 260, easing: 'ease-out' },
        );
        completedRounds += 1;
        progress = 0;
        strain = 0;
        holding = false;
        offset = 0;
        if (completedRounds === totalRounds) {
          opened = true;
          // Let the existing unlock animation finish, then tell the room page.
          setTimeout(function () {
            window.parent.postMessage(
              { type: 'apsu-lockpick-success', itemId: toolItems[selectedPick]?.id },
              '*',
            );
          }, 1150);
        } else {
          attemptsLeft = attemptLimits[currentLevel - 1];
          attemptActive = false;
          chooseNextTarget();
          // Release before starting the next round to avoid surprise damage.
          waitingForRelease = true;
        }
      } else if (health <= 0) {
        holding = false;
        offset = 0;
      }
    } else {
      // Unfinished progress drains at the same pace it fills.
      progress = Math.max(0, progress - seconds / holdDuration);
      strain = 0;

      // Opposite keys cancel each other; releasing one keeps the other active.
      let direction = mouseDirection;

      if (leftHeld) direction -= 1;
      if (rightHeld) direction += 1;

      direction = Math.max(-1, Math.min(1, direction));

      if (direction !== 0) {
        stopDragging();
        pickAngle += direction * turnSpeed * seconds;
      } else if (dragPointer !== null) {
        const follow = 1 - Math.exp(-22 * seconds);
        pickAngle += (dragAngle - pickAngle) * follow;
      }

      pickAngle = Math.max(-90, Math.min(90, pickAngle));
    }
  }

  let desiredPush = 0;

  if (inserted && !opened && health > 0 && !waitingForRelease) {
    desiredPush = dragPointer !== null ? manualPush : spaceHeld || mouseTrying ? 24 : 0;
  }

  pushDepth += (desiredPush - pushDepth) * (1 - Math.exp(-22 * seconds));
  drawPick(offset);
  drawRing();
  requestAnimationFrame(updateGame);
}

function beginAttempt(manual = false) {
  if (!inserted || opened || health <= 0 || waitingForRelease) return false;
  if (attemptActive) return true;
  if (attemptsLeft <= 0) return false;
  if (!manual) stopDragging();

  attemptsLeft -= 1;
  attemptActive = true;

  return true;
}

function finishAttempt() {
  if (spaceHeld || mouseTrying || manualTrying) return;
  // The last attempt can still succeed before the player releases.
  if (attemptActive && attemptsLeft === 0 && !opened && health > 0) {
    ranOutOfAttempts = true;
    health = 0;
  }

  attemptActive = false;
  waitingForRelease = false;
  strain = 0;
}

leftButton.addEventListener('mousedown', function (event) {
  if (event.button === 0) mouseDirection = -1;
});
rightButton.addEventListener('mousedown', function (event) {
  if (event.button === 0) mouseDirection = 1;
});
tryButton.addEventListener('mousedown', function (event) {
  if (event.button === 0 && beginAttempt()) mouseTrying = true;
});
window.addEventListener('mouseup', function (event) {
  if (event.button === 0) {
    mouseDirection = 0;
    mouseTrying = false;
    finishAttempt();
  }
});

window.addEventListener('keydown', function (event) {
  if (event.code === 'Space') event.preventDefault();
  if (!inserted) return;
  if (event.repeat) return;
  if (event.code === 'KeyQ') leftHeld = true;
  if (event.code === 'KeyE') rightHeld = true;
  if (event.code === 'Space' && beginAttempt()) spaceHeld = true;
});
window.addEventListener('keyup', function (event) {
  if (event.code === 'Space') event.preventDefault();
  if (event.code === 'KeyQ') leftHeld = false;
  if (event.code === 'KeyE') rightHeld = false;
  if (event.code === 'Space') {
    spaceHeld = false;
    finishAttempt();
  }
});

window.addEventListener('blur', resetInputs);
document.addEventListener('visibilitychange', function () {
  if (document.hidden) resetInputs();

  previousTime = performance.now();
});

// Escape also cancels when keyboard focus is inside this iframe.
window.addEventListener('keydown', function (event) {
  if (event.code === 'Escape') {
    event.preventDefault();
    window.parent.postMessage({ type: 'apsu-lockpick-cancel' }, '*');
  }
});

startLevel(configuredLevel);
const sparePicks = [];

function refreshSparePicks() {
  sparePicks.forEach((element, index) => {
    element.style.visibility =
      index === selectedPick || keyInserted || opened ? 'hidden' : 'visible';
    element.style.backgroundColor =
      toolItems[index].capacity <= 50 ? '#E8A0AA' : 'var(--metal-tool)';
    element.title =
      'Lockpick ' +
      (toolItems[index].slot || index + 1) +
      ' — ' +
      toolItems[index].capacity +
      '% capacity';
  });
}

toolItems.forEach((item, index) => {
  const spare = document.createElement('div');
  spare.className = 'spare-pick';
  spare.style.right = 12 + index * 24 + 'px';
  spare.addEventListener('pointerdown', function (event) {
    if (
      event.button !== 0 ||
      keyInserted ||
      inserted ||
      snapping ||
      opened ||
      failurePopped ||
      dragPointer !== null
    )
      return;

    event.preventDefault();
    toolItems[selectedPick].health = health;
    selectedPick = index;
    itemCapacity = item.capacity;
    reportedDamage = itemCapacity <= 50;
    startLevel(currentLevel);
    health = item.health ?? itemCapacity;
    drawRing();
    refreshSparePicks();
    // Hand this same pointer to the original mechanic, preserving its drag behavior.
    pick.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
        bubbles: true,
      }),
    );
  });
  document.body.appendChild(spare);
  sparePicks.push(spare);
});
refreshSparePicks();

if (hasKey) {
  const key = document.createElement('div');
  key.className = 'door-key';
  key.tabIndex = 0;
  key.setAttribute('role', 'button');
  key.setAttribute(
    'aria-label',
    'Matching key. Drag into the keyhole, then turn counterclockwise. Keyboard: Enter to insert, Q to turn.',
  );
  key.innerHTML =
    '<svg viewBox="0 0 36 132" aria-hidden="true"><g class="key-body"><circle cx="18" cy="22" r="15" fill="var(--color-100)" stroke="var(--color-700)" stroke-width="6"/><path d="M18 39V120" fill="none" stroke="var(--color-700)" stroke-width="7" stroke-linecap="round"/><path class="key-teeth" d="M18 91H30M18 105H28" fill="none" stroke="var(--color-700)" stroke-width="7" stroke-linecap="round"/></g></svg>';
  document.body.appendChild(key);
  let pointer = null,
    grabX = 0,
    grabY = 0,
    lastAngle = 0,
    keyAngle = 0;

  function anchorKey() {
    const hole = keyhole.getBoundingClientRect();
    key.style.left = (hole.left + hole.right) / 2 - 18 + 'px';
    key.style.top = (hole.top + hole.bottom) / 2 - 120 + 'px';
    key.style.right = 'auto';
    key.style.bottom = 'auto';
    key.style.transform = 'rotate(' + (90 + keyAngle) + 'deg)';
  }

  function keyTipOverHole() {
    const bounds = key.getBoundingClientRect();
    const hole = keyhole.getBoundingClientRect();
    // The loose key is rotated +90 degrees around its tip.
    const tipX = bounds.left + 12,
      tipY = bounds.top + 18;

    return (
      tipX >= hole.left - 12 &&
      tipX <= hole.right + 12 &&
      tipY >= hole.top - 12 &&
      tipY <= hole.bottom + 12
    );
  }

  function insertKey() {
    if (inserted || snapping || opened) return;

    keyInserted = true;
    anchorKey();
    keyhole.classList.remove('drop-ready');
    // Keep the shaft above the black opening; clip only beyond its far edge.
    key.classList.add('seated');
    refreshSparePicks();
    drawRing();
  }

  function turnKey(delta) {
    if (!keyInserted || keyFinished) return;

    keyAngle = Math.max(-90, Math.min(0, keyAngle + delta));
    key.style.transform = 'rotate(' + (90 + keyAngle) + 'deg)';
    keyhole.style.transform = 'rotate(' + keyAngle + 'deg)';
    if (keyAngle <= -90) {
      keyFinished = true;
      opened = true;
      refreshSparePicks();
      setTimeout(function () {
        window.parent.postMessage({ type: 'apsu-key-success' }, '*');
      }, 400);
    }
  }

  key.addEventListener('pointerdown', function (event) {
    if (
      event.button !== 0 ||
      opened ||
      inserted ||
      snapping ||
      dragPointer !== null ||
      pointer !== null
    )
      return;

    event.preventDefault();
    pointer = event.pointerId;
    key.setPointerCapture(pointer);
    const bounds = key.getBoundingClientRect();
    grabX = event.clientX - (bounds.left + 12);
    grabY = event.clientY - (bounds.top + 18);
    lastAngle = pointerAngle(event);
  });
  key.addEventListener('pointermove', function (event) {
    if (event.pointerId !== pointer) return;
    if (keyInserted) {
      if (pointerDistance(event) < 20) return;

      const angle = pointerAngle(event);
      const delta = ((angle - lastAngle + 540) % 360) - 180;
      lastAngle = angle;
      turnKey(delta);
    } else {
      key.style.left = event.clientX - grabX - 18 + 'px';
      key.style.top = event.clientY - grabY - 120 + 'px';
      key.style.right = 'auto';
      key.style.bottom = 'auto';
      keyhole.classList.toggle('drop-ready', keyTipOverHole());
    }
  });

  function releaseKey(event, canceled) {
    if (event.pointerId !== pointer) return;
    if (key.hasPointerCapture(pointer)) key.releasePointerCapture(pointer);

    pointer = null;
    keyhole.classList.remove('drop-ready');
    if (keyInserted) return;
    if (!canceled && keyTipOverHole()) {
      insertKey();
    } else {
      key.style.left = '';
      key.style.top = '';
      key.style.right = '';
      key.style.bottom = '';
    }
  }

  key.addEventListener('pointerup', (event) => releaseKey(event, false));
  key.addEventListener('pointercancel', (event) => releaseKey(event, true));
  key.addEventListener('keydown', function (event) {
    if (event.code === 'Enter' && !keyInserted) {
      event.preventDefault();
      insertKey();
    }
    if (event.code === 'KeyQ' && keyInserted) {
      event.preventDefault();
      turnKey(-5);
    }
  });
  window.addEventListener('resize', function () {
    if (keyInserted) anchorKey();
  });
}

// Report interaction, not animation frames, so idle players time out.
for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'wheel']) {
  window.addEventListener(eventName, function () {
    window.parent.postMessage({ type: 'apsu-lock-activity' }, '*');
  });
}

requestAnimationFrame(updateGame);
