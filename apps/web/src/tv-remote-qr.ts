const QR_VERSION = 10;
const QR_SIZE = 17 + QR_VERSION * 4;
const QR_MARGIN = 4;
const QR_DATA_CODEWORDS = 216;
const QR_EC_CODEWORDS_PER_BLOCK = 26;
const QR_DATA_BLOCK_SIZES = [43, 43, 43, 43, 44] as const;
const QR_MAX_BYTE_LENGTH = 213;

const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);
let x = 1;
for (let i = 0; i < 255; i += 1) {
  gfExp[i] = x;
  gfLog[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < gfExp.length; i += 1) gfExp[i] = gfExp[i - 255];

function gfMultiply(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  return gfExp[gfLog[a] + gfLog[b]];
}

function generatorPolynomial(degree: number) {
  let polynomial = [1];
  for (let i = 0; i < degree; i += 1) {
    const factor = gfExp[i];
    const next = new Array<number>(polynomial.length + 1).fill(0);
    for (let j = 0; j < polynomial.length; j += 1) {
      next[j] ^= polynomial[j];
      next[j + 1] ^= gfMultiply(polynomial[j], factor);
    }
    polynomial = next;
  }
  return polynomial;
}

const ecGenerator = generatorPolynomial(QR_EC_CODEWORDS_PER_BLOCK);

function errorCorrection(data: readonly number[]) {
  const message = [...data, ...new Array<number>(QR_EC_CODEWORDS_PER_BLOCK).fill(0)];
  for (let offset = 0; offset < data.length; offset += 1) {
    const coefficient = message[offset];
    if (coefficient === 0) continue;
    for (let i = 0; i < ecGenerator.length; i += 1) {
      message[offset + i] ^= gfMultiply(ecGenerator[i], coefficient);
    }
  }
  return message.slice(-QR_EC_CODEWORDS_PER_BLOCK);
}

function appendBits(bits: number[], value: number, length: number) {
  for (let shift = length - 1; shift >= 0; shift -= 1) bits.push((value >>> shift) & 1);
}

function dataCodewords(value: string) {
  const bytes = [...new TextEncoder().encode(value)];
  if (bytes.length > QR_MAX_BYTE_LENGTH) {
    throw new Error(`Endereço do controle remoto excede ${QR_MAX_BYTE_LENGTH} bytes.`);
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4); // byte mode
  appendBits(bits, bytes.length, 16); // version 10 byte count
  for (const byte of bytes) appendBits(bits, byte, 8);

  const capacity = QR_DATA_CODEWORDS * 8;
  for (let i = 0; i < Math.min(4, capacity - bits.length); i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const codewords: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let byte = 0;
    for (let i = 0; i < 8; i += 1) byte = (byte << 1) | bits[offset + i];
    codewords.push(byte);
  }

  let pad = true;
  while (codewords.length < QR_DATA_CODEWORDS) {
    codewords.push(pad ? 0xec : 0x11);
    pad = !pad;
  }
  return codewords;
}

function interleavedCodewords(value: string) {
  const data = dataCodewords(value);
  const blocks: Array<{ data: number[]; ec: number[] }> = [];
  let offset = 0;
  for (const size of QR_DATA_BLOCK_SIZES) {
    const block = data.slice(offset, offset + size);
    offset += size;
    blocks.push({ data: block, ec: errorCorrection(block) });
  }

  const result: number[] = [];
  for (let index = 0; index < 44; index += 1) {
    for (const block of blocks) {
      if (index < block.data.length) result.push(block.data[index]);
    }
  }
  for (let index = 0; index < QR_EC_CODEWORDS_PER_BLOCK; index += 1) {
    for (const block of blocks) result.push(block.ec[index]);
  }
  return result;
}

function bchDigit(value: number) {
  let digit = 0;
  while (value) {
    digit += 1;
    value >>>= 1;
  }
  return digit;
}

function bchRemainder(value: number, generator: number) {
  let result = value;
  while (bchDigit(result) >= bchDigit(generator)) {
    result ^= generator << (bchDigit(result) - bchDigit(generator));
  }
  return result;
}

function formatBits() {
  const data = 0; // error correction M (00), mask 0 (000)
  return (((data << 10) | bchRemainder(data << 10, 0x537)) ^ 0x5412) >>> 0;
}

function versionBits() {
  return ((QR_VERSION << 12) | bchRemainder(QR_VERSION << 12, 0x1f25)) >>> 0;
}

type MatrixCell = boolean | null;

function addFinder(matrix: MatrixCell[][], row: number, column: number) {
  for (let y = -1; y <= 7; y += 1) {
    const targetRow = row + y;
    if (targetRow < 0 || targetRow >= QR_SIZE) continue;
    for (let xOffset = -1; xOffset <= 7; xOffset += 1) {
      const targetColumn = column + xOffset;
      if (targetColumn < 0 || targetColumn >= QR_SIZE) continue;
      matrix[targetRow][targetColumn] = (
        (y >= 0 && y <= 6 && (xOffset === 0 || xOffset === 6))
        || (xOffset >= 0 && xOffset <= 6 && (y === 0 || y === 6))
        || (y >= 2 && y <= 4 && xOffset >= 2 && xOffset <= 4)
      );
    }
  }
}

function addAlignment(matrix: MatrixCell[][]) {
  const centers = [6, 28, 50];
  for (const row of centers) {
    for (const column of centers) {
      if (matrix[row][column] !== null) continue;
      for (let y = -2; y <= 2; y += 1) {
        for (let xOffset = -2; xOffset <= 2; xOffset += 1) {
          matrix[row + y][column + xOffset] = Math.max(Math.abs(y), Math.abs(xOffset)) !== 1;
        }
      }
    }
  }
}

function addTiming(matrix: MatrixCell[][]) {
  for (let row = 8; row < QR_SIZE - 8; row += 1) {
    if (matrix[row][6] === null) matrix[row][6] = row % 2 === 0;
  }
  for (let column = 8; column < QR_SIZE - 8; column += 1) {
    if (matrix[6][column] === null) matrix[6][column] = column % 2 === 0;
  }
}

function addVersionInfo(matrix: MatrixCell[][]) {
  const bits = versionBits();
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    matrix[Math.floor(i / 3)][(i % 3) + QR_SIZE - 11] = dark;
    matrix[(i % 3) + QR_SIZE - 11][Math.floor(i / 3)] = dark;
  }
}

function addFormatInfo(matrix: MatrixCell[][]) {
  const bits = formatBits();
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    if (i < 6) matrix[i][8] = dark;
    else if (i < 8) matrix[i + 1][8] = dark;
    else matrix[QR_SIZE - 15 + i][8] = dark;

    if (i < 8) matrix[8][QR_SIZE - i - 1] = dark;
    else if (i < 9) matrix[8][15 - i] = dark;
    else matrix[8][15 - i - 1] = dark;
  }
  matrix[QR_SIZE - 8][8] = true;
}

function mask(row: number, column: number) {
  return (row + column) % 2 === 0;
}

export function buildTvRemoteQrMatrix(value: string): boolean[][] {
  const matrix: MatrixCell[][] = Array.from({ length: QR_SIZE }, () => new Array<MatrixCell>(QR_SIZE).fill(null));
  addFinder(matrix, 0, 0);
  addFinder(matrix, QR_SIZE - 7, 0);
  addFinder(matrix, 0, QR_SIZE - 7);
  addAlignment(matrix);
  addTiming(matrix);
  addVersionInfo(matrix);
  addFormatInfo(matrix);

  const codewords = interleavedCodewords(value);
  let byteIndex = 0;
  let bitIndex = 7;
  let row = QR_SIZE - 1;
  let direction = -1;

  for (let column = QR_SIZE - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const targetColumn = column - offset;
        if (matrix[row][targetColumn] !== null) continue;
        let dark = byteIndex < codewords.length && ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        if (mask(row, targetColumn)) dark = !dark;
        matrix[row][targetColumn] = dark;
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += direction;
      if (row >= 0 && row < QR_SIZE) continue;
      row -= direction;
      direction = -direction;
      break;
    }
  }

  return matrix.map(line => line.map(cell => cell === true));
}

export function tvRemoteQrDataUrl(value: string) {
  const matrix = buildTvRemoteQrMatrix(value);
  const size = QR_SIZE + QR_MARGIN * 2;
  const path = matrix.flatMap((line, row) => line.flatMap((dark, column) => (
    dark ? [`M${column + QR_MARGIN} ${row + QR_MARGIN}h1v1h-1z`] : []
  ))).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="black"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
