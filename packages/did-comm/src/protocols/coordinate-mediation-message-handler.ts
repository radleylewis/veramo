import {
  IAgentContext,
  IDIDManager,
  IKeyManager,
  IDataStore,
  IIdentifier,
  MinimalImportableIdentifier,
} from '@veramo/core-types'
import { AbstractMessageHandler, Message } from '@veramo/message-handler'
import Debug from 'debug'
import { v4 } from 'uuid'
import { IDIDComm } from '../types/IDIDComm.js'
import { IDIDCommMessage, DIDCommMessageMediaType } from '../types/message-types.js'

const debug = Debug('veramo:did-comm:coordinate-mediation-message-handler')

type IContext = IAgentContext<IDIDManager & IKeyManager & IDIDComm & IDataStore>

interface Update {
  recipient_did: string
  action: 'add' | 'remove'
}
interface UpdateResult extends Update {
  result: 'success' | 'no_change' | 'client_error' | 'server_error'
}
type RecipientUpdateBody<T extends Update | UpdateResult> = {
  updates: T[]
}

interface RecipientUpdateMessage<T extends Update | UpdateResult> extends IDIDCommMessage {
  type: CoordinateMediation.RECIPIENT_UPDATE
  body: RecipientUpdateBody<T>
  return_route: 'all'
}

/**
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export enum CoordinateMediation {
  MEDIATE_REQUEST = 'https://didcomm.org/coordinate-mediation/3.0/mediate-request',
  MEDIATE_GRANT = 'https://didcomm.org/coordinate-mediation/3.0/mediate-grant',
  MEDIATE_DENY = 'https://didcomm.org/coordinate-mediation/3.0/mediate-deny',
  RECIPIENT_UPDATE = 'https://didcomm.org/coordinate-mediation/3.0/recipient-update',
  RECIPIENT_UPDATE_RESPONSE = 'https://didcomm.org/coordinate-mediation/3.0/recipient-update-response',
  RECIPIENT = 'https://didcomm.org/coordinate-mediation/3.0/recipient',
}
/**
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export const STATUS_REQUEST_MESSAGE_TYPE = 'https://didcomm.org/messagepickup/3.0/status-request'

/**
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export const DELIVERY_REQUEST_MESSAGE_TYPE = 'https://didcomm.org/messagepickup/3.0/delivery-request'

/**
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export function createMediateRequestMessage(
  recipientDidUrl: string,
  mediatorDidUrl: string,
): IDIDCommMessage {
  return {
    type: CoordinateMediation.MEDIATE_REQUEST,
    from: recipientDidUrl,
    to: mediatorDidUrl,
    id: v4(),
    created_time: new Date().toISOString(),
    body: {},
  }
}

/**
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export function createMediateGrantMessage(
  recipientDidUrl: string,
  mediatorDidUrl: string,
  thid: string,
): IDIDCommMessage {
  return {
    type: CoordinateMediation.MEDIATE_GRANT,
    from: mediatorDidUrl,
    to: recipientDidUrl,
    id: v4(),
    thid: thid,
    created_time: new Date().toISOString(),
    body: {
      routing_did: [mediatorDidUrl],
    },
  }
}

/**
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export function createStatusRequestMessage(recipientDidUrl: string, mediatorDidUrl: string): IDIDCommMessage {
  return {
    id: v4(),
    type: STATUS_REQUEST_MESSAGE_TYPE,
    to: mediatorDidUrl,
    from: recipientDidUrl,
    return_route: 'all',
    body: {},
  }
}

/**
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export function createRecipientUpdateMessage(
  recipientDidUrl: string,
  mediatorDidUrl: string,
  updates: Update[],
): RecipientUpdateMessage<Update> {
  return {
    type: CoordinateMediation.RECIPIENT_UPDATE,
    from: recipientDidUrl,
    to: mediatorDidUrl,
    id: v4(),
    created_time: new Date().toISOString(),
    body: { updates: updates },
    return_route: 'all',
  }
}

/**
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export function createDeliveryRequestMessage(
  recipientDidUrl: string,
  mediatorDidUrl: string,
): IDIDCommMessage {
  return {
    id: v4(),
    type: DELIVERY_REQUEST_MESSAGE_TYPE,
    to: mediatorDidUrl,
    from: recipientDidUrl,
    return_route: 'all',
    body: { limit: 2 },
  }
}

/**
 * A plugin for the {@link @veramo/message-handler#MessageHandler} that handles Mediator Coordinator messages for the mediator role.
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export class CoordinateMediationMediatorMessageHandler extends AbstractMessageHandler {
  constructor() {
    super()
  }

  private async handleMediateRequest(message: Message, context: IContext): Promise<Message> {
    const { to, from } = message
    debug('MediateRequest Message Received')
    if (!from) {
      throw new Error('invalid_argument: MediateRequest received without `from` set')
    }
    if (!to) {
      throw new Error('invalid_argument: MediateRequest received without `to` set')
    }
    // Grant requests to all recipients
    // TODO: Come up with a method for approving and rejecting recipients
    const response = createMediateGrantMessage(from, to, message.id)
    const packedResponse = await context.agent.packDIDCommMessage({
      message: response,
      packing: 'authcrypt',
    })
    const returnResponse = {
      id: response.id,
      message: packedResponse.message,
      contentType: DIDCommMessageMediaType.ENCRYPTED,
    }
    message.addMetaData({ type: 'ReturnRouteResponse', value: JSON.stringify(returnResponse) })
    // Save message to track recipients
    await context.agent.dataStoreSaveMessage({
      message: {
        type: response.type,
        from: response.from,
        to: response.to,
        id: response.id,
        threadId: response.thid,
        data: response.body,
        createdAt: response.created_time,
      },
    })
    return message
  }

  /**
   * Used to notify the mediator of DIDs in use by the recipient
   **/
  private async handleRecipientUpdate(
    message: RecipientUpdateMessage<Update>,
    context: IContext,
  ): Promise<Message> {
    const {
      to,
      from: recipient_did,
      body: { updates = [] },
    } = message
    debug('MediateRecipientUpdate Message Received')
    if (!recipient_did) {
      throw new Error('invalid_argument: MediateRecipientUpdate received without `from` set')
    }
    if (!to) {
      throw new Error('invalid_argument: MediateRecipientUpdate received without `to` set')
    }
    if (!updates.length) {
      throw new Error('invalid_argument: MediateRecipientUpdate received without `updates` set')
    }

    // get the recipient did document
    const didDoc: IIdentifier = await context.agent.didManagerGet({ did: recipient_did })
    // add the updates to the did document
    const updater = {
      async add(didDoc: IIdentifier, update: Update): Promise<UpdateResult> {
        const result = await context.agent.dataStoreAddRecipientDid({
          recipient: didDoc.did,
          recipient_did: update.recipient_did,
        })
        if (result) return { ...update, result: 'success' }
        return { ...update, result: 'no_change' }
      },
      async remove(didDoc: IIdentifier, update: Update): Promise<UpdateResult> {
        const result = await context.agent.dataStoreRemoveRecipientDid({
          recipient: didDoc.did,
          recipient_did: update.recipient_did,
        })
        if (result) return { ...update, result: 'success' }
        return { ...update, result: 'no_change' }
      },
    }
    const appliedUpdates = updates.map(async (update) => await updater[update.action](didDoc, update))

    // TODO: add meta data and address ts complaints on return type
    // @ts-ignore
    return message
  }

  /**
   * Handles a Mediator Coordinator messages for the mediator role
   * https://didcomm.org/mediator-coordination/3.0/
   */
  public async handle(message: Message, context: IContext): Promise<Message> {
    try {
      if (message.type === CoordinateMediation.MEDIATE_REQUEST) {
        return await this.handleMediateRequest(message, context)
      }
      if (message.type === CoordinateMediation.RECIPIENT_UPDATE) {
        // TODO: validate message format
        // @ts-ignore
        return await this.handleRecipientUpdate(message, context)
      }
    } catch (ex) {
      debug(ex)
    }

    return super.handle(message, context)
  }
}

/**
 * A plugin for the {@link @veramo/message-handler#MessageHandler} that handles Mediator Coordinator messages for the recipient role.
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export class CoordinateMediationRecipientMessageHandler extends AbstractMessageHandler {
  constructor() {
    super()
  }

  /**
   * Handles a Mediator Coordinator messages for the recipient role
   * https://didcomm.org/mediator-coordination/2.0/
   */
  public async handle(message: Message, context: IContext): Promise<Message> {
    if (message.type === CoordinateMediation.MEDIATE_GRANT) {
      debug('MediateGrant Message Received')
      try {
        const { from, to, data, threadId } = message
        if (!from) {
          throw new Error('invalid_argument: MediateGrant received without `from` set')
        }
        if (!to) {
          throw new Error('invalid_argument: MediateGrant received without `to` set')
        }
        if (!threadId) {
          throw new Error('invalid_argument: MediateGrant received without `thid` set')
        }
        if (!data.routing_did || data.routing_did.length === 0) {
          throw new Error('invalid_argument: MediateGrant received with invalid routing_did')
        }
        // If mediate request was previously sent, add service to DID document
        const prevRequestMsg = await context.agent.dataStoreGetMessage({ id: threadId })
        if (prevRequestMsg.from === to && prevRequestMsg.to === from) {
          const service = {
            id: 'didcomm-mediator',
            type: 'DIDCommMessaging',
            serviceEndpoint: [
              {
                uri: data.routing_did[0],
              },
            ],
          }
          await context.agent.didManagerAddService({
            did: to,
            service: service,
          })
          message.addMetaData({ type: 'DIDCommMessagingServiceAdded', value: JSON.stringify(service) })
        }
      } catch (ex) {
        debug(ex)
      }
      return message
    } else if (message.type === CoordinateMediation.MEDIATE_DENY) {
      debug('MediateDeny Message Received')
      try {
        const { from, to } = message
        if (!from) {
          throw new Error('invalid_argument: MediateGrant received without `from` set')
        }
        if (!to) {
          throw new Error('invalid_argument: MediateGrant received without `to` set')
        }

        // Delete service if it exists
        const did = await context.agent.didManagerGet({
          did: to,
        })
        const existingService = did.services.find(
          (s) =>
            s.serviceEndpoint === from ||
            (Array.isArray(s.serviceEndpoint) && s.serviceEndpoint.includes(from)),
        )
        if (existingService) {
          await context.agent.didManagerRemoveService({ did: to, id: existingService.id })
        }
      } catch (ex) {
        debug(ex)
      }
    }

    return super.handle(message, context)
  }
}
