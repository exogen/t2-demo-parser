import type { BitStream } from "./BitStream.js";

// Hardcoded character frequency table from the V12 engine (bitStream.cc)
// These are used to build the Huffman tree for string compression.
const CSM_CHAR_FREQS: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 329, 21, 0, 0, 0, 0, 0, // 0-15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16-31
  2809, 68, 0, 27, 0, 58, 3, 62, 4, 7, 0, 0, 15, 65, 554, 3, // 32-47
  394, 404, 189, 117, 30, 51, 27, 15, 34, 32, 80, 1, 142, 3, 142, 39, // 48-63
  0, 144, 125, 44, 122, 275, 70, 135, 61, 127, 8, 12, 113, 246, 122, 36, // 64-79
  185, 1, 149, 309, 335, 12, 11, 14, 54, 151, 0, 0, 2, 0, 0, 211, // 80-95
  0, 2090, 344, 736, 993, 2872, 701, 605, 646, 1552, 328, 305, 1240, 735, 1533, 1713, // 96-111
  562, 3, 1775, 1149, 1469, 979, 407, 553, 59, 279, 31, 0, 0, 0, 68, 0, // 112-127
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 128-143
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 144-159
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 160-175
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 176-191
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 192-207
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 208-223
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 224-239
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 240-255
];

const PROB_BOOST = 1;

function isAlphaNumeric(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || // 0-9
    (c >= 65 && c <= 90) || // A-Z
    (c >= 97 && c <= 122) // a-z
  );
}

interface HuffNode {
  pop: number;
  index0: number;
  index1: number;
}

interface HuffLeaf {
  pop: number;
  symbol: number;
  numBits: number;
  code: number;
}

interface HuffWrap {
  node: HuffNode | null;
  leaf: HuffLeaf | null;
}

function wrapGetPop(w: HuffWrap): number {
  if (w.node) return w.node.pop;
  return w.leaf!.pop;
}

export class HuffmanProcessor {
  private nodes: HuffNode[] = [];
  private leaves: HuffLeaf[] = [];
  private tablesBuilt = false;

  buildTables(): void {
    if (this.tablesBuilt) return;
    this.tablesBuilt = true;

    // Initialize leaves from frequency table
    this.leaves = [];
    for (let i = 0; i < 256; i++) {
      this.leaves.push({
        pop:
          CSM_CHAR_FREQS[i] +
          (isAlphaNumeric(i) ? PROB_BOOST : 0) +
          PROB_BOOST,
        symbol: i,
        numBits: 0,
        code: 0,
      });
    }

    // Initialize nodes array with one placeholder at index 0
    this.nodes = [{ pop: 0, index0: 0, index1: 0 }];

    // Build wraps array
    let currWraps = 256;
    const wraps: HuffWrap[] = [];
    for (let i = 0; i < 256; i++) {
      wraps.push({ node: null, leaf: this.leaves[i] });
    }

    // Build the Huffman tree by repeatedly combining the two lowest-population wraps
    while (currWraps !== 1) {
      let min1 = 0xfffffffe;
      let min2 = 0xffffffff;
      let index1 = -1;
      let index2 = -1;

      for (let i = 0; i < currWraps; i++) {
        const pop = wrapGetPop(wraps[i]);
        if (pop < min1) {
          min2 = min1;
          index2 = index1;
          min1 = pop;
          index1 = i;
        } else if (pop < min2) {
          min2 = pop;
          index2 = i;
        }
      }

      // Create a new node combining the two smallest
      const newNode: HuffNode = {
        pop: wrapGetPop(wraps[index1]) + wrapGetPop(wraps[index2]),
        index0: this.determineIndex(wraps[index1]),
        index1: this.determineIndex(wraps[index2]),
      };
      this.nodes.push(newNode);

      // Replace the lower-indexed wrap with the new node, remove the higher-indexed one
      const mergeIndex = index1 < index2 ? index1 : index2;
      const nukeIndex = index1 > index2 ? index1 : index2;
      wraps[mergeIndex] = { node: newNode, leaf: null };

      if (nukeIndex !== currWraps - 1) {
        wraps[nukeIndex] = wraps[currWraps - 1];
      }
      currWraps--;
    }

    // The root node should be at nodes[0]
    this.nodes[0] = wraps[0].node!;

    // Generate Huffman codes by walking the tree
    this.generateCodes(0, 0, 0);
  }

  private determineIndex(wrap: HuffWrap): number {
    if (wrap.leaf !== null) {
      // Leaf index is encoded as -(leafArrayIndex + 1)
      const leafIdx = this.leaves.indexOf(wrap.leaf);
      return -(leafIdx + 1);
    } else {
      return this.nodes.indexOf(wrap.node!);
    }
  }

  private generateCodes(code: number, nodeIndex: number, depth: number): void {
    if (nodeIndex < 0) {
      // Leaf node
      const leaf = this.leaves[-(nodeIndex + 1)];
      leaf.code = code;
      leaf.numBits = depth;
    } else {
      const node = this.nodes[nodeIndex];
      // Go left (0 bit)
      this.generateCodes(code, node.index0, depth + 1);
      // Go right (1 bit)
      this.generateCodes(code | (1 << depth), node.index1, depth + 1);
    }
  }

  readHuffBuffer(stream: BitStream): string {
    if (!this.tablesBuilt) {
      this.buildTables();
    }

    if (stream.readFlag()) {
      // Huffman-compressed string
      const len = stream.readInt(8);
      const chars: number[] = [];
      for (let i = 0; i < len; i++) {
        let index = 0;
        while (true) {
          if (index >= 0) {
            if (stream.readFlag()) {
              index = this.nodes[index].index1;
            } else {
              index = this.nodes[index].index0;
            }
          } else {
            chars.push(this.leaves[-(index + 1)].symbol);
            break;
          }
        }
      }
      return String.fromCharCode(...chars);
    } else {
      // Uncompressed string
      const len = stream.readInt(8);
      const bytes = stream.readBytes(len);
      return String.fromCharCode(...bytes);
    }
  }
}

// Singleton instance matching the C++ g_huffProcessor
export const huffProcessor = new HuffmanProcessor();
