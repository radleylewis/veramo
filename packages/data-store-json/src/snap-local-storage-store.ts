import { Json } from '@metamask/snaps-sdk'
import { IIdentifier, IMessage, ManagedKeyInfo } from '@veramo/core-types'
import { ManagedPrivateKey } from '@veramo/key-manager'
import {
  DiffCallback,
  VeramoJsonCache,
  ClaimTableEntry,
  CredentialTableEntry,
  PresentationTableEntry,
  VeramoJsonStore,
} from './types.js'

/**
 * Implementation of {@link VeramoJsonStore} that uses browser localStorage to store data.
 *
 * @example
 * ```
 * const dataStore = SnapLocalStorageStore.fromLocalStorage('veramo-state')
 * const plugin = new DataStoreJson(dataStore)
 * ```
 *
 * @public
 */
export class SnapLocalStorageStore implements VeramoJsonStore {
  notifyUpdate: DiffCallback
  dids: Record<string, IIdentifier>
  keys: Record<string, ManagedKeyInfo>
  privateKeys: Record<string, ManagedPrivateKey>
  credentials: Record<string, CredentialTableEntry>
  claims: Record<string, ClaimTableEntry>
  presentations: Record<string, PresentationTableEntry>
  messages: Record<string, IMessage>

  private constructor(private localStorageKey: string) {
    this.notifyUpdate = async (_oldState: VeramoJsonCache, newState: VeramoJsonCache) => {
      this.save(newState)
    }
    this.dids = {}
    this.keys = {}
    this.privateKeys = {}
    this.credentials = {}
    this.claims = {}
    this.presentations = {}
    this.messages = {}
  }

  public static fromLocalStorage(localStorageKey: string): Promise<SnapLocalStorageStore> {
    const store = new SnapLocalStorageStore(localStorageKey)
    return store.load()
  }

  private async getSnapState(): Promise<Record<string, Json>> {
    if (!snap) throw Error('global snap object not found. Are you in the right context?')
    const snapState =
      (await snap.request({
        method: 'snap_manageState',
        params: { operation: 'get' },
      })) || {}
    return snapState
  }

  private async load(): Promise<SnapLocalStorageStore> {
    const snapState = await this.getSnapState()
    const rawCache = snapState[this.localStorageKey]
    let cache: VeramoJsonCache
    try {
      cache = JSON.parse(rawCache?.toString() || '{}')
    } catch (e: any) {
      cache = {}
    }
    ;({
      dids: this.dids,
      keys: this.keys,
      credentials: this.credentials,
      claims: this.claims,
      presentations: this.presentations,
      messages: this.messages,
      privateKeys: this.privateKeys,
    } = {
      dids: {},
      keys: {},
      credentials: {},
      claims: {},
      presentations: {},
      messages: {},
      privateKeys: {},
      ...cache,
    })
    return this
  }

  private async save(newState: VeramoJsonCache): Promise<void> {
    if (!snap) throw Error('global snap object not found. Are you in the right context?')
    const snapState = await this.getSnapState()
    const newLocalStorageState = { ...snapState, [this.localStorageKey]: JSON.stringify(newState) }
    await snap.request({
      method: 'snap_manageState',
      params: { operation: 'update', newState: newLocalStorageState },
    })
  }
}
