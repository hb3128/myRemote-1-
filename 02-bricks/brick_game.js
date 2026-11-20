"use strict";

const canvas = document.querySelector("#game-board");
const context = canvas.getContext("2d");
const scoreDisplay = document.querySelector("#score");
const livesDisplay = document.querySelector("#lives");
const message = document.querySelector("#game-message");
const messageTitle = document.querySelector("#message-title");
const messageDetail = document.querySelector("#message-detail");

const BRICK = { width: 48, height: 22, gap: 4, top: 26 };
// #은 벽돌, .은 공이 지날 수 있는 빈 칸입니다.
const MAZE = [
  "#.####.####.####.####.#",
  "..#....#..#...#....#...",
  "###.####.###.####.##.##",
  "....#.#..............#.",
  ".####.####.####.###.###",
  "..#.....#..#....#...#..",
  "##.#.##.#####.##.#####.",
  "...#..#...#....#...#...",
  "####.####.##.#####.##.#",
  ".#...#........#........",
  "#.####.####.##.#####.##",
  "..#....#....#....#..#..",
  "###.####.###.###.##.###",
  "....#...#..#.........#.",
  "#.###.####.####.#####.#",
];
const BLAST_BRICKS = new Set(["0:4", "2:18", "4:7", "6:14", "7:15", "10:4", "12:18", "14:8"]);
const BLAST_DURATION = 0.28;
const MAX_MYSTERY_BALLS = 10;
const BRICK_COLORS = [
  "#f3dfc8", "#ead0b4", "#dfbd9b", "#d1a981", "#c1946c",
  "#aa7952", "#9e6d48", "#90603e", "#825335", "#74482e",
  "#663e28", "#583423", "#4a2b1d", "#3d2218",
];
const BALL_SPEED = 510;
const PADDLE_SPEED = 660;
const STEP = 1 / 240;
const BALL_SPACING_STEPS = 8;
const paddle = { x: 0, y: canvas.height - 44, width: 180, height: 16 };
const pressedKeys = new Set();

let bricks = [];
let balls = [];
let trail = [];
let trailStep = 0;
let blasts = [];
let score = 0;
let lives = 3;
let phase = "ready";
let previousTime = 0;
let remainingTime = 0;

const instructions = {
  ready: ["시작할 준비가 됐나요?", "스페이스 키를 눌러 공을 출발시키세요."],
  retry: ["공을 놓쳤어요", "스페이스 키를 눌러 같은 판을 이어 가세요."],
  won: ["모든 벽돌을 깼어요!", "스페이스 키를 눌러 새 판을 준비하세요."],
  lost: ["기회를 모두 사용했어요", "스페이스 키를 눌러 새 판을 준비하세요."],
};

function updateScoreboard() {
  scoreDisplay.textContent = score;
  livesDisplay.textContent = lives;
}

function setPhase(nextPhase) {
  phase = nextPhase;
  const currentMessage = instructions[nextPhase];
  message.hidden = !currentMessage;
  if (currentMessage) {
    [messageTitle.textContent, messageDetail.textContent] = currentMessage;
  }
}

function createBricks() {
  const columns = MAZE[0].length;
  const rowWidth = columns * BRICK.width + (columns - 1) * BRICK.gap;
  const left = (canvas.width - rowWidth) / 2;
  const result = [];
  let bonusCount = 0;
  let ordinaryCount = 0;

  for (let row = 0; row < MAZE.length; row += 1) {
    const minimumHealth = 8 - Math.round(row * 7 / (MAZE.length - 1));
    for (let column = 0; column < columns; column += 1) {
      if (MAZE[row][column] !== "#") {
        continue;
      }

      const explosive = BLAST_BRICKS.has(row + ":" + column);
      let extraBalls = 0;
      if (result.length % 2 === 0) {
        extraBalls = (bonusCount % 5) + 1;
        bonusCount += 1;
      } else if (!explosive) {
        // 일반 벽돌 아홉 개 중 다섯 개에 공 추가 보상을 붙입니다.
        if (ordinaryCount % 9 < 5) {
          extraBalls = (ordinaryCount % 5) + 1;
        }
        ordinaryCount += 1;
      }
      result.push({
        row,
        column,
        explosive,
        x: left + column * (BRICK.width + BRICK.gap),
        y: BRICK.top + row * (BRICK.height + BRICK.gap),
        health: minimumHealth + (row + column) % 3,
        extraBalls,
      });
    }
  }
  return result;
}

function placeBallOnPaddle() {
  const ball = balls[0];
  ball.x = paddle.x + paddle.width / 2;
  ball.y = paddle.y - ball.radius;
}

function resetPaddleAndBall() {
  paddle.x = (canvas.width - paddle.width) / 2;
  balls = [{ x: 0, y: 0, radius: 7, vx: 0, vy: 0 }];
  placeBallOnPaddle();

  // 가장 뒤에 붙을 공까지 따라올 수 있는 길이만큼 위치를 기록합니다.
  const possibleBonusBalls = bricks.reduce((count, brick) => {
    return count + (brick.explosive ? MAX_MYSTERY_BALLS : brick.extraBalls);
  }, 0);
  trail = new Array(possibleBonusBalls * BALL_SPACING_STEPS + 1);
  trailStep = 0;
}

function resetGame() {
  bricks = createBricks();
  blasts = [];
  score = 0;
  lives = 3;
  resetPaddleAndBall();
  updateScoreboard();
  setPhase("ready");
}

function launchBall() {
  const ball = balls[0];
  const angle = Math.PI / 6;
  ball.vx = BALL_SPEED * Math.sin(angle);
  ball.vy = -BALL_SPEED * Math.cos(angle);
  setPhase("playing");
}

function loseBall() {
  lives -= 1;
  updateScoreboard();

  if (lives === 0) {
    setPhase("lost");
  } else {
    resetPaddleAndBall();
    setPhase("retry");
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function movePaddle(seconds) {
  const direction = Number(pressedKeys.has("ArrowRight")) - Number(pressedKeys.has("ArrowLeft"));
  paddle.x = clamp(paddle.x + direction * PADDLE_SPEED * seconds, 0, canvas.width - paddle.width);
}

function bounceOffPaddle(ball, previousX, previousY) {
  const contactY = paddle.y - ball.radius;
  if (ball.y <= previousY || previousY > contactY || ball.y < contactY) {
    return false;
  }

  const crossing = (contactY - previousY) / (ball.y - previousY);
  const contactX = previousX + (ball.x - previousX) * crossing;
  if (contactX < paddle.x - ball.radius || contactX > paddle.x + paddle.width + ball.radius) {
    return false;
  }

  // 막대의 가운데에 맞으면 위로, 가장자리에 맞으면 더 비스듬히 튕깁니다.
  const halfWidth = paddle.width / 2;
  const offset = clamp((contactX - paddle.x - halfWidth) / halfWidth, -1, 1);
  const angle = offset * Math.PI / 3;
  ball.y = contactY;
  ball.vx = BALL_SPEED * Math.sin(angle);
  ball.vy = -BALL_SPEED * Math.cos(angle);
  return true;
}

function addBonusBalls(count) {
  const lastBall = balls[balls.length - 1];
  const sampleStep = lastBall.sampleStep ?? trailStep;
  for (let index = 0; index < count; index += 1) {
    balls.push({ x: lastBall.x, y: lastBall.y, radius: lastBall.radius, sampleStep });
  }
}

function damageBrick(brick) {
  if (brick.health === 0) {
    return;
  }

  brick.health -= 1;
  if (brick.health === 0) {
    destroyBrick(brick);
  }
}

function destroyBrick(firstBrick) {
  const destroyed = new Set([firstBrick]);
  const pending = [firstBrick];

  // 대각선을 포함한 주변 한 칸을 터뜨리고, 이미 포함된 벽돌은 다시 세지 않습니다.
  for (let index = 0; index < pending.length; index += 1) {
    const brick = pending[index];
    if (!brick.explosive) {
      continue;
    }

    blasts.push({ x: brick.x + BRICK.width / 2, y: brick.y + BRICK.height / 2, time: BLAST_DURATION });
    for (const neighbor of bricks) {
      const nearby = Math.abs(neighbor.row - brick.row) <= 1
        && Math.abs(neighbor.column - brick.column) <= 1;
      if (nearby && !destroyed.has(neighbor)) {
        destroyed.add(neighbor);
        if (neighbor.explosive) {
          pending.push(neighbor);
        }
      }
    }
  }

  let extraBalls = 0;
  for (const brick of destroyed) {
    brick.health = 0;
    extraBalls += brick.explosive
      ? 1 + Math.floor(Math.random() * MAX_MYSTERY_BALLS)
      : brick.extraBalls;
  }
  addBonusBalls(extraBalls);
  bricks = bricks.filter((brick) => !destroyed.has(brick));
  score += destroyed.size * 10;
  updateScoreboard();
  if (bricks.length === 0) {
    setPhase("won");
  }
}

function checkBrickCollision(ball) {
  for (const brick of bricks) {
    const nearestX = clamp(ball.x, brick.x, brick.x + BRICK.width);
    const nearestY = clamp(ball.y, brick.y, brick.y + BRICK.height);
    const dx = ball.x - nearestX;
    const dy = ball.y - nearestY;
    const distance = Math.hypot(dx, dy);
    if (distance >= ball.radius || distance === 0) {
      continue;
    }

    // 벽돌 표면에서 공을 떼어 낸 뒤, 표면에 접근하는 속도만 반대로 바꿉니다.
    const normalX = dx / distance;
    const normalY = dy / distance;
    const approachSpeed = ball.vx * normalX + ball.vy * normalY;
    if (approachSpeed >= 0) {
      continue;
    }

    ball.x = nearestX + normalX * ball.radius;
    ball.y = nearestY + normalY * ball.radius;
    ball.vx -= 2 * approachSpeed * normalX;
    ball.vy -= 2 * approachSpeed * normalY;
    damageBrick(brick);
    return brick;
  }
  return null;
}

function update(seconds) {
  if (blasts.length > 0) {
    for (const blast of blasts) {
      blast.time -= seconds;
    }
    blasts = blasts.filter((blast) => blast.time > 0);
  }

  if (phase === "won" || phase === "lost") {
    return;
  }

  movePaddle(seconds);
  if (phase !== "playing") {
    placeBallOnPaddle();
    return;
  }

  moveBallChain(seconds);
}

function moveBallChain(seconds) {
  const leader = balls[0];
  const existingBallCount = balls.length;
  trailStep += 1;
  const hit = moveBall(leader, seconds);

  // 새 공이 붙은 시점부터 선두 공의 위치와 충돌을 시간차를 두고 따라갑니다.
  trail[trailStep % trail.length] = { x: leader.x, y: leader.y, hit };
  const leaderMissed = leader.y > paddle.y - leader.radius;
  let caughtIndex = 0;
  let caughtBall;

  for (let index = 1; index < existingBallCount && phase === "playing"; index += 1) {
    const ball = balls[index];
    const sampleStep = trailStep - index * BALL_SPACING_STEPS;
    if (sampleStep <= ball.sampleStep) {
      continue;
    }

    const sample = trail[sampleStep % trail.length];
    const previousX = ball.x;
    const previousY = ball.y;
    ball.x = sample.x;
    ball.y = sample.y;
    ball.sampleStep = sampleStep;

    if (leaderMissed && caughtIndex === 0 && previousY <= paddle.y - ball.radius) {
      const candidate = { x: ball.x, y: ball.y, radius: ball.radius, vx: 0, vy: 0 };
      if (bounceOffPaddle(candidate, previousX, previousY)) {
        caughtIndex = index;
        caughtBall = candidate;
      }
    }

    if (sample.hit) {
      damageBrick(sample.hit);
    }
  }

  if (caughtIndex > 0 && phase === "playing") {
    // 새 선두가 있던 시점부터 경로를 이어 그려 뒤 공들의 간격을 유지합니다.
    trailStep = balls[caughtIndex].sampleStep;
    trail[trailStep % trail.length] = { x: caughtBall.x, y: caughtBall.y, hit: null };
    balls.splice(0, caughtIndex + 1, caughtBall);
  }

  // 꼬리까지 화면 아래로 내려간 뒤에 기회를 한 번 차감합니다.
  const lastBall = balls[balls.length - 1];
  if (phase === "playing" && lastBall.y - lastBall.radius > canvas.height) {
    loseBall();
  }
}

function moveBall(ball, seconds) {
  const previousX = ball.x;
  const previousY = ball.y;
  ball.x += ball.vx * seconds;
  ball.y += ball.vy * seconds;

  if (ball.x < ball.radius || ball.x > canvas.width - ball.radius) {
    ball.x = clamp(ball.x, ball.radius, canvas.width - ball.radius);
    ball.vx = -ball.vx;
  }
  if (ball.y < ball.radius) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy);
  }

  bounceOffPaddle(ball, previousX, previousY);
  return checkBrickCollision(ball);
}

function drawBrick(brick) {
  const { x, y, health, extraBalls, explosive } = brick;
  const { width, height } = BRICK;
  const color = BRICK_COLORS[health - 1];
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  if (explosive) {
    context.fillStyle = "#80520d";
    context.fillRect(x, y, width, height);
    context.fillStyle = "hsl(43, 86%, " + (82 - health * 2.5) + "%)";
    context.fillRect(x + 2, y + 2, width - 4, height - 4);
    context.fillStyle = "#fff0b3";
    context.fillRect(x + 3, y + 2, width - 6, 1);
    context.fillStyle = "#482a06";
    context.fillRect(x + width - 8, centerY - 1, 3, 2);
  } else {
    context.fillStyle = "#38261e";
    context.fillRect(x, y, width, height);
    context.fillStyle = color;
    context.fillRect(x + 1, y + 1, 17, 9);
    context.fillRect(x + 20, y + 1, width - 21, 9);
    context.fillRect(x + 1, y + 12, 27, 9);
    context.fillRect(x + 30, y + 12, width - 31, 9);
    context.fillStyle = "#ffffff36";
    context.fillRect(x + 2, y + 2, 15, 1);
    context.fillRect(x + 21, y + 2, width - 23, 1);
    context.fillRect(x + 2, y + 13, 25, 1);
    context.fillRect(x + 31, y + 13, width - 33, 1);
  }

  if (!explosive) {
    context.fillStyle = color;
    context.fillRect(centerX - 12, y + 2, 24, height - 4);
  }

  context.fillStyle = explosive || health <= 6 ? "#201309" : "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 16px sans-serif";
  context.fillText(String(health), centerX, centerY);

  if (explosive || extraBalls > 0) {
    context.font = "bold 11px sans-serif";
    context.fillText(explosive ? "?" : "+", x + 8, centerY);
  }
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const blast of blasts) {
    const strength = blast.time / BLAST_DURATION;
    context.strokeStyle = "rgba(191, 109, 9, " + strength + ")";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(blast.x, blast.y, 12 + (1 - strength) * 50, 0, Math.PI * 2);
    context.stroke();
  }
  for (const brick of bricks) {
    drawBrick(brick);
  }

  context.fillStyle = "#000";
  context.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);

  if (balls.length > 1) {
    context.strokeStyle = "#b5d9f5";
    context.lineWidth = 8;
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(balls[0].x, balls[0].y);
    for (const ball of balls.slice(1)) {
      context.lineTo(ball.x, ball.y);
    }
    context.stroke();
  }

  context.fillStyle = "#000";
  for (const ball of balls) {
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
  }
}

function animate(time) {
  if (previousTime !== 0) {
    remainingTime += Math.min((time - previousTime) / 1000, 0.05);
  }
  previousTime = time;

  // 화면 갱신 속도와 관계없이 같은 시간 간격으로 공의 위치를 계산합니다.
  while (remainingTime >= STEP) {
    update(STEP);
    remainingTime -= STEP;
  }
  draw();
  requestAnimationFrame(animate);
}

window.addEventListener("keydown", (event) => {
  if (event.code === "Tab") {
    event.preventDefault();
    if (!event.repeat) {
      pressedKeys.clear();
      resetGame();
    }
    return;
  }

  if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
    event.preventDefault();
    pressedKeys.add(event.code);
  }
  if (event.code !== "Space") {
    return;
  }

  event.preventDefault();
  if (event.repeat) {
    return;
  }
  if (phase === "ready" || phase === "retry") {
    launchBall();
  } else if (phase === "won" || phase === "lost") {
    resetGame();
  }
});

window.addEventListener("keyup", (event) => pressedKeys.delete(event.code));
window.addEventListener("blur", () => pressedKeys.clear());

resetGame();
draw();
requestAnimationFrame(animate);
