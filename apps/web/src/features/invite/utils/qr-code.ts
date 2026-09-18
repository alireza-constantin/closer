// QR version 6-M: 41x41 modules, four 43-codeword blocks, 16 ECC bytes/block.
// This keeps the invite URL opaque while allowing normal production hostnames.
const QR_SIZE = 41;
const QR_DATA_CODEWORDS = 108;
const QR_ECC_CODEWORDS_PER_BLOCK = 16;
const QR_BLOCK_COUNT = 4;
const QR_BLOCK_DATA_CODEWORDS = 27;
const QR_BLOCK_TOTAL_CODEWORDS = 43;

function multiply(a: number, b: number) {
  let result = 0;
  let left = a;
  let right = b;
  while (right > 0) {
    if (right & 1) result ^= left;
    left <<= 1;
    if (left & 0x100) left ^= 0x11d;
    right >>>= 1;
  }
  return result;
}

function reedSolomonGenerator(degree: number) {
  const generator = [1];
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j += 1) {
      next[j] ^= generator[j];
      next[j + 1] ^= multiply(generator[j], root);
    }
    generator.splice(0, generator.length, ...next);
    root = multiply(root, 2);
  }
  return generator;
}

function reedSolomonRemainder(data: number[], degree: number) {
  const generator = reedSolomonGenerator(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const value of data) {
    const factor = value ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let i = 0; i < degree; i += 1) {
      remainder[i] ^= multiply(generator[i + 1], factor);
    }
  }
  return remainder;
}

function pushBits(target: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) target.push((value >>> i) & 1);
}

function createCodewords(value: string) {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > 106) throw new Error("QR_PAYLOAD_TOO_LONG");

  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, 8);
  for (const byte of bytes) pushBits(bits, byte, 8);
  pushBits(bits, 0, Math.min(4, QR_DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((result, bit) => (result << 1) | bit, 0));
  }
  let pad = 0;
  while (codewords.length < QR_DATA_CODEWORDS) {
    codewords.push(pad % 2 === 0 ? 0xec : 0x11);
    pad += 1;
  }

  const dataBlocks = Array.from({ length: QR_BLOCK_COUNT }, (_, index) =>
    codewords.slice(index * QR_BLOCK_DATA_CODEWORDS, (index + 1) * QR_BLOCK_DATA_CODEWORDS),
  );
  const errorBlocks = dataBlocks.map((block) =>
    reedSolomonRemainder(block, QR_ECC_CODEWORDS_PER_BLOCK),
  );
  const interleaved: number[] = [];
  for (let i = 0; i < QR_BLOCK_DATA_CODEWORDS; i += 1) {
    for (const block of dataBlocks) interleaved.push(block[i]);
  }
  for (let i = 0; i < QR_ECC_CODEWORDS_PER_BLOCK; i += 1) {
    for (const block of errorBlocks) interleaved.push(block[i]);
  }
  return interleaved;
}

function bchRemainder(value: number, polynomial: number) {
  let result = value;
  const polynomialDegree = Math.floor(Math.log2(polynomial));
  while (Math.floor(Math.log2(result)) >= polynomialDegree) {
    result ^= polynomial << (Math.floor(Math.log2(result)) - polynomialDegree);
  }
  return result;
}

function formatBits(mask: number) {
  const data = mask;
  const rem = bchRemainder(data << 10, 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function createMatrix(codewords: number[], mask: number) {
  const modules = Array.from({ length: QR_SIZE }, () =>
    new Array<boolean | null>(QR_SIZE).fill(null),
  );
  const functions = Array.from({ length: QR_SIZE }, () => new Array<boolean>(QR_SIZE).fill(false));

  function setFunction(row: number, column: number, value: boolean) {
    if (row >= 0 && row < QR_SIZE && column >= 0 && column < QR_SIZE) {
      modules[row][column] = value;
      functions[row][column] = true;
    }
  }

  function drawFinder(row: number, column: number) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark =
          inside &&
          (dx === 0 ||
            dx === 6 ||
            dy === 0 ||
            dy === 6 ||
            (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setFunction(row + dy, column + dx, dark);
      }
    }
  }

  drawFinder(0, 0);
  drawFinder(QR_SIZE - 7, 0);
  drawFinder(0, QR_SIZE - 7);

  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    if (!functions[6][i]) setFunction(6, i, i % 2 === 0);
    if (!functions[i][6]) setFunction(i, 6, i % 2 === 0);
  }

  const alignmentPositions = [6, QR_SIZE - 7];
  for (const row of alignmentPositions) {
    for (const column of alignmentPositions) {
      if (
        (row === 6 && column === 6) ||
        (row === 6 && column === QR_SIZE - 7) ||
        (row === QR_SIZE - 7 && column === 6)
      )
        continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          setFunction(
            row + dy,
            column + dx,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1 || (dx === 0 && dy === 0),
          );
        }
      }
    }
  }

  for (let i = 0; i < 15; i += 1) {
    const verticalRow = i < 6 ? i : i < 8 ? i + 1 : QR_SIZE - 15 + i;
    const horizontalColumn = i < 8 ? QR_SIZE - i - 1 : i < 9 ? 15 - i : 14 - i;
    const secondHorizontalColumn = i < 8 ? i : i < 9 ? i + 1 : QR_SIZE - 15 + i;
    setFunction(verticalRow, 8, false);
    setFunction(8, horizontalColumn, false);
    setFunction(QR_SIZE - i - 1, 8, false);
    setFunction(8, secondHorizontalColumn, false);
  }
  setFunction(QR_SIZE - 8, 8, true);

  const bits = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >>> i) & 1) !== 0;
    const verticalRow = i < 6 ? i : i < 8 ? i + 1 : QR_SIZE - 15 + i;
    const horizontalColumn = i < 8 ? QR_SIZE - i - 1 : i < 9 ? 15 - i : 14 - i;
    modules[verticalRow][8] = dark;
    modules[8][horizontalColumn] = dark;
    modules[QR_SIZE - i - 1][8] = dark;
    modules[8][i < 8 ? i : i < 9 ? i + 1 : QR_SIZE - 15 + i] = dark;
  }

  const dataBits = codewords.flatMap((codeword) =>
    Array.from({ length: 8 }, (_, i) => (codeword >>> (7 - i)) & 1),
  );
  let bitIndex = 0;
  let upward = true;
  for (let column = QR_SIZE - 1; column >= 1; column -= 2) {
    if (column === 6) column -= 1;
    for (let offset = 0; offset < QR_SIZE; offset += 1) {
      const row = upward ? QR_SIZE - 1 - offset : offset;
      for (const currentColumn of [column, column - 1]) {
        if (functions[row][currentColumn]) continue;
        const raw = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
        bitIndex += 1;
        const masked =
          mask === 0
            ? (row + currentColumn) % 2 === 0
            : mask === 1
              ? row % 2 === 0
              : mask === 2
                ? currentColumn % 3 === 0
                : mask === 3
                  ? (row + currentColumn) % 3 === 0
                  : mask === 4
                    ? (Math.floor(row / 2) + Math.floor(currentColumn / 3)) % 2 === 0
                    : mask === 5
                      ? ((row * currentColumn) % 2) + ((row * currentColumn) % 3) === 0
                      : mask === 6
                        ? (((row * currentColumn) % 2) + ((row * currentColumn) % 3)) % 2 === 0
                        : (((row * currentColumn) % 3) + ((row + currentColumn) % 2)) % 2 === 0;
        modules[row][currentColumn] = raw !== masked;
      }
    }
    upward = !upward;
  }

  return modules as boolean[][];
}

function penalty(matrix: boolean[][]) {
  let score = 0;
  for (let row = 0; row < QR_SIZE; row += 1) {
    for (let column = 0; column < QR_SIZE; column += 1) {
      if (
        row + 1 < QR_SIZE &&
        column + 1 < QR_SIZE &&
        matrix[row][column] === matrix[row + 1][column] &&
        matrix[row][column] === matrix[row][column + 1] &&
        matrix[row][column] === matrix[row + 1][column + 1]
      )
        score += 3;
      if (
        row + 6 < QR_SIZE &&
        matrix[row][column] &&
        !matrix[row + 1][column] &&
        matrix[row + 2][column] &&
        matrix[row + 3][column] &&
        matrix[row + 4][column] &&
        !matrix[row + 5][column] &&
        matrix[row + 6][column]
      )
        score += 40;
      if (
        column + 6 < QR_SIZE &&
        matrix[row][column] &&
        !matrix[row][column + 1] &&
        matrix[row][column + 2] &&
        matrix[row][column + 3] &&
        matrix[row][column + 4] &&
        !matrix[row][column + 5] &&
        matrix[row][column + 6]
      )
        score += 40;
    }
  }
  for (const line of [
    ...matrix,
    ...Array.from({ length: QR_SIZE }, (_, column) => matrix.map((row) => row[column])),
  ]) {
    let runColor = line[0];
    let runLength = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === runColor) runLength += 1;
      else {
        if (runLength >= 5) score += runLength - 2;
        runColor = line[i];
        runLength = 1;
      }
    }
    if (runLength >= 5) score += runLength - 2;
  }
  const darkModules = matrix.flat().filter(Boolean).length;
  score +=
    Math.floor(Math.abs(darkModules * 20 - QR_SIZE * QR_SIZE * 10) / (QR_SIZE * QR_SIZE)) * 10;
  return score;
}

export function encodeQrSvg(value: string) {
  const codewords = createCodewords(value);
  let best = createMatrix(codewords, 0);
  let bestScore = penalty(best);
  for (let mask = 1; mask < 8; mask += 1) {
    const candidate = createMatrix(codewords, mask);
    const candidateScore = penalty(candidate);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  const quiet = 4;
  const size = QR_SIZE + quiet * 2;
  const path = best
    .flatMap((row, rowIndex) =>
      row.flatMap((dark, columnIndex) =>
        dark ? [`M${columnIndex + quiet} ${rowIndex + quiet}h1v1h-1z`] : [],
      ),
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Scan this QR code to join Closer"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#102565"/></svg>`;
}
