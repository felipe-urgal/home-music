const VERSION = 6;
const SIZE = 21 + (VERSION - 1) * 4;
const DATA_CODEWORDS = 136;
const BLOCK_DATA_CODEWORDS = 68;
const EC_CODEWORDS = 18;
const MAX_BYTE_LENGTH = 134;

type Cell = boolean | null;

export type QrMatrix = Readonly<{
  size: number;
  cells: readonly (readonly boolean[])[];
}>;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let fieldValue = 1;
for (let index = 0; index < 255; index += 1) {
  EXP[index] = fieldValue;
  LOG[fieldValue] = index;
  fieldValue <<= 1;
  if (fieldValue & 0x100) fieldValue ^= 0x11d;
}
for (let index = 255; index < EXP.length; index += 1) EXP[index] = EXP[index - 255];

function gfMultiply(left: number, right: number) {
  if (left === 0 || right === 0) return 0;
  return EXP[LOG[left] + LOG[right]];
}

function generatorPolynomial(degree: number) {
  let result = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(result.length + 1).fill(0);
    const alpha = EXP[index];
    for (let offset = 0; offset < result.length; offset += 1) {
      next[offset] ^= result[offset];
      next[offset + 1] ^= gfMultiply(result[offset], alpha);
    }
    result = next;
  }
  return result;
}

const EC_GENERATOR = generatorPolynomial(EC_CODEWORDS);

function errorCorrection(data: readonly number[]) {
  const working = [...data, ...new Array<number>(EC_CODEWORDS).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const factor = working[index];
    if (factor === 0) continue;
    for (let offset = 0; offset < EC_GENERATOR.length; offset += 1) {
      working[index + offset] ^= gfMultiply(EC_GENERATOR[offset], factor);
    }
  }
  return working.slice(data.length);
}

function appendBits(target: number[], value: number, length: number) {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push((value >> bit) & 1);
}

function encodeData(value: string) {
  const bytes = [...new TextEncoder().encode(value)];
  if (bytes.length > MAX_BYTE_LENGTH) {
    throw new RangeError('URL de aprovação longa demais para o QR da TV.');
  }

  const capacityBits = DATA_CODEWORDS * 8;
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);

  const terminatorLength = Math.min(4, capacityBits - bits.length);
  for (let index = 0; index < terminatorLength; index += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  let paddingIndex = 0;
  while (bits.length < capacityBits) {
    appendBits(bits, paddingIndex % 2 === 0 ? 0xec : 0x11, 8);
    paddingIndex += 1;
  }

  const codewords: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let codeword = 0;
    for (let bit = 0; bit < 8; bit += 1) codeword = (codeword << 1) | bits[offset + bit];
    codewords.push(codeword);
  }
  return codewords;
}

function encodedBits(value: string) {
  const data = encodeData(value);
  const blocks = [
    data.slice(0, BLOCK_DATA_CODEWORDS),
    data.slice(BLOCK_DATA_CODEWORDS)
  ];
  const correction = blocks.map(block => errorCorrection(block));
  const codewords: number[] = [];

  for (let index = 0; index < BLOCK_DATA_CODEWORDS; index += 1) {
    for (const block of blocks) codewords.push(block[index]);
  }
  for (let index = 0; index < EC_CODEWORDS; index += 1) {
    for (const block of correction) codewords.push(block[index]);
  }

  const bits: number[] = [];
  for (const codeword of codewords) appendBits(bits, codeword, 8);
  return bits;
}

function placeFinder(matrix: Cell[][], row: number, column: number) {
  for (let rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 7; columnOffset += 1) {
      const targetRow = row + rowOffset;
      const targetColumn = column + columnOffset;
      if (
        targetRow < 0 || targetRow >= SIZE
        || targetColumn < 0 || targetColumn >= SIZE
      ) continue;

      matrix[targetRow][targetColumn] = rowOffset >= 0 && rowOffset <= 6
        && columnOffset >= 0 && columnOffset <= 6
        && (
          rowOffset === 0 || rowOffset === 6
          || columnOffset === 0 || columnOffset === 6
          || (
            rowOffset >= 2 && rowOffset <= 4
            && columnOffset >= 2 && columnOffset <= 4
          )
        );
    }
  }
}

function placeAlignment(matrix: Cell[][]) {
  const centers = [6, 34];
  for (const row of centers) {
    for (const column of centers) {
      if (matrix[row][column] !== null) continue;
      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
          matrix[row + rowOffset][column + columnOffset] = (
            Math.abs(rowOffset) === 2
            || Math.abs(columnOffset) === 2
            || (rowOffset === 0 && columnOffset === 0)
          );
        }
      }
    }
  }
}

function bitLength(value: number) {
  let length = 0;
  for (let remaining = value; remaining !== 0; remaining >>>= 1) length += 1;
  return length;
}

function formatBits() {
  const data = 1 << 3; // nível L (01), máscara 0
  const generator = 0x537;
  let remainder = data << 10;
  while (bitLength(remainder) >= bitLength(generator)) {
    remainder ^= generator << (bitLength(remainder) - bitLength(generator));
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function placeFormat(matrix: Cell[][]) {
  const bits = formatBits();
  for (let index = 0; index < 15; index += 1) {
    const dark = ((bits >> index) & 1) === 1;

    if (index < 6) matrix[index][8] = dark;
    else if (index < 8) matrix[index + 1][8] = dark;
    else matrix[SIZE - 15 + index][8] = dark;

    if (index < 8) matrix[8][SIZE - index - 1] = dark;
    else if (index < 9) matrix[8][15 - index] = dark;
    else matrix[8][15 - index - 1] = dark;
  }
  matrix[SIZE - 8][8] = true;
}

function placeFunctionPatterns(matrix: Cell[][]) {
  placeFinder(matrix, 0, 0);
  placeFinder(matrix, SIZE - 7, 0);
  placeFinder(matrix, 0, SIZE - 7);
  placeAlignment(matrix);

  for (let index = 8; index < SIZE - 8; index += 1) {
    if (matrix[index][6] === null) matrix[index][6] = index % 2 === 0;
    if (matrix[6][index] === null) matrix[6][index] = index % 2 === 0;
  }
  placeFormat(matrix);
}

function placeData(matrix: Cell[][], data: readonly number[]) {
  let row = SIZE - 1;
  let direction = -1;
  let bitIndex = 0;

  for (let column = SIZE - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;

    while (true) {
      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const targetColumn = column - columnOffset;
        if (matrix[row][targetColumn] !== null) continue;

        let bit = bitIndex < data.length ? data[bitIndex] : 0;
        bitIndex += 1;
        if ((row + targetColumn) % 2 === 0) bit ^= 1;
        matrix[row][targetColumn] = bit === 1;
      }

      row += direction;
      if (row >= 0 && row < SIZE) continue;
      row -= direction;
      direction *= -1;
      break;
    }
  }
}

export function qrMatrixForValue(value: string): QrMatrix {
  const matrix = Array.from({ length: SIZE }, () => new Array<Cell>(SIZE).fill(null));
  placeFunctionPatterns(matrix);
  placeData(matrix, encodedBits(value));

  return Object.freeze({
    size: SIZE,
    cells: Object.freeze(matrix.map(row => Object.freeze(row.map(cell => Boolean(cell)))))
  });
}
