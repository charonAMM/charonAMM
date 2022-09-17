import { Element, HashFunction, MerkleTreeOptions, ProofPath, SerializedTreeState, TreeEdge, TreeSlice } from './'
import defaultHash from './simpleHash'
import { BaseTree } from './BaseTree'


export default class MerkleTree extends BaseTree {
  constructor(levels: number, elements: Element[] = [], {
    hashFunction = defaultHash,
    zeroElement = 0,
  }: MerkleTreeOptions = {}) {
    super()
    this.levels = levels
    if (elements.length > this.capacity) {
      throw new Error('Tree is full')
    }
    this._hashFn = hashFunction
    this.zeroElement = zeroElement
    this._layers = []
    const leaves = elements.slice()
    this._layers = [leaves]
    this._buildZeros()
    this._buildHashes()
  }

  private _buildHashes() {
    for (let layerIndex = 1; layerIndex <= this.levels; layerIndex++) {
      const nodes = this._layers[layerIndex - 1]
      this._layers[layerIndex] = this._processNodes(nodes, layerIndex)
    }
  }


  /**
   * Insert multiple elements into the tree.
   * @param {Array} elements Elements to insert
   */
  bulkInsert(elements: Element[]): void {
    if (!elements.length) {
      return
    }

    if (this._layers[0].length + elements.length > this.capacity) {
      throw new Error('Tree is full')
    }
    // First we insert all elements except the last one
    // updating only full subtree hashes (all layers where inserted element has odd index)
    // the last element will update the full path to the root making the tree consistent again
    for (let i = 0; i < elements.length - 1; i++) {
      this._layers[0].push(elements[i])
      let level = 0
      let index = this._layers[0].length - 1
      while (index % 2 === 1) {
        level++
        index >>= 1
        this._layers[level][index] = this._hashFn(
          this._layers[level - 1][index * 2],
          this._layers[level - 1][index * 2 + 1],
        )
      }
    }
    this.insert(elements[elements.length - 1])
  }

  indexOf(element: Element, comparator?: <T> (arg0: T, arg1: T) => boolean): number {
    return BaseTree.indexOf(this._layers[0], element, 0, comparator)
  }

  proof(element: Element): ProofPath {
    const index = this.indexOf(element)
    return this.path(index)
  }

  static index_to_key(prefix: string, level: number, index: number) {
    const key = `${prefix}_tree_${level}_${index}`;
    return key;
}

  async root() {
    let root = await this.storage.get_or_element(
        MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
        this.zero_values[this.n_levels]
    );
    return root;
}

  getTreeEdge(edgeIndex: number): TreeEdge {
    const edgeElement = this._layers[0][edgeIndex]
    if (edgeElement === undefined) {
      throw new Error('Element not found')
    }
    const edgePath = this.path(edgeIndex)
    return { edgePath, edgeElement, edgeIndex, edgeElementsCount: this._layers[0].length }
  }

  /**
   * 🪓
   * @param count
   */
  getTreeSlices(count = 4): TreeSlice[] {
    const length = this._layers[0].length
    let size = Math.ceil(length / count)
    if (size % 2) size++
    const slices: TreeSlice[] = []
    for (let i = 0; i < length; i += size) {
      const edgeLeft = i
      const edgeRight = i + size
      slices.push({ edge: this.getTreeEdge(edgeLeft), elements: this.elements.slice(edgeLeft, edgeRight) })
    }
    return slices
  }

  /**
   * Serialize entire tree state including intermediate layers into a plain object
   * Deserializing it back will not require to recompute any hashes
   * Elements are not converted to a plain type, this is responsibility of the caller
   */
  serialize(): SerializedTreeState {
    return {
      levels: this.levels,
      _zeros: this._zeros,
      _layers: this._layers,
    }
  }

  /**
   * Deserialize data into a MerkleTree instance
   * Make sure to provide the same hashFunction as was used in the source tree,
   * otherwise the tree state will be invalid
   */
  static deserialize(data: SerializedTreeState, hashFunction?: HashFunction<Element>): MerkleTree {
    const instance: MerkleTree = Object.assign(Object.create(this.prototype), data)
    instance._hashFn = hashFunction || defaultHash
    instance.zeroElement = instance._zeros[0]
    return instance
  }

  toString() {
    return JSON.stringify(this.serialize())
  }
}

