import {
  IAgentPlugin,
  IDataStore,
  IDataStoreDeleteVerifiableCredentialArgs,
  IDataStoreGetMessageArgs,
  IDataStoreDeleteMessageArgs,
  IDataStoreGetVerifiableCredentialArgs,
  IDataStoreGetVerifiablePresentationArgs,
  IDataStoreSaveMessageArgs,
  IDataStoreSaveVerifiableCredentialArgs,
  IDataStoreSaveVerifiablePresentationArgs,
  IMessage,
  VerifiableCredential,
  VerifiablePresentation,
  IDataStoreAddRecipientDid,
  IDataStoreRemoveRecipientDid,
  IDataStoreListRecipientDids,
} from '@veramo/core-types'
import schema from '@veramo/core-types/build/plugin.schema.json' assert { type: 'json' }
import { createMessage, createMessageEntity, Message } from './entities/message.js'
import { createCredentialEntity, Credential } from './entities/credential.js'
import { Claim } from './entities/claim.js'
import { createPresentationEntity, Presentation } from './entities/presentation.js'
import { RecipientDid } from './entities/recipient_did.js'
import { DataSource } from 'typeorm'
import { getConnectedDb } from './utils.js'
import { OrPromise } from '@veramo/utils'
import { Identifier } from './entities/identifier.js'

/**
 * This class implements the {@link @veramo/core-types#IDataStore} interface using a TypeORM compatible database.
 *
 * This allows you to store and retrieve Verifiable Credentials, Presentations and Messages by their IDs.
 *
 * For more complex queries you should use {@link @veramo/data-store#DataStoreORM} which is the default way to query
 * the stored data by some common properties. These two classes MUST also share the same database connection.
 *
 * @see {@link @veramo/core-types#IDataStoreORM}
 * @see {@link @veramo/core-types#IDataStore}
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export class DataStore implements IAgentPlugin {
  readonly methods: IDataStore
  readonly schema = schema.IDataStore
  private dbConnection: OrPromise<DataSource>

  constructor(dbConnection: OrPromise<DataSource>) {
    this.dbConnection = dbConnection

    this.methods = {
      dataStoreSaveMessage: this.dataStoreSaveMessage.bind(this),
      dataStoreGetMessage: this.dataStoreGetMessage.bind(this),
      dataStoreDeleteMessage: this.dataStoreDeleteMessage.bind(this),
      dataStoreDeleteVerifiableCredential: this.dataStoreDeleteVerifiableCredential.bind(this),
      dataStoreSaveVerifiableCredential: this.dataStoreSaveVerifiableCredential.bind(this),
      dataStoreGetVerifiableCredential: this.dataStoreGetVerifiableCredential.bind(this),
      dataStoreSaveVerifiablePresentation: this.dataStoreSaveVerifiablePresentation.bind(this),
      dataStoreGetVerifiablePresentation: this.dataStoreGetVerifiablePresentation.bind(this),

      // dataStoreAddRecipientDid: this.dataStoreAddRecipientDid.bind(this),
      // dataStoreRemoveRecipientDid: this.dataStoreRemoveRecipientDid.bind(this),
      // dataStoreListRecipientDids: this.dataStoreListRecipientDids.bind(this),
    }
  }

  async dataStoreSaveMessage(args: IDataStoreSaveMessageArgs): Promise<string> {
    const message = await (await getConnectedDb(this.dbConnection))
      .getRepository(Message)
      .save(createMessageEntity(args.message))
    return message.id
  }

  // async dataStoreAddRecipientDid({ did, recipient_did }: IDataStoreAddRecipientDid): Promise<string> {
  //   const db = await getConnectedDb(this.dbConnection)
  //   const identifier = await db.getRepository(Identifier).findOneBy({ did })
  //   if (!identifier) throw new Error('not_found: Identifier not found')
  //   const result = await db.getRepository(RecipientDid).save({ identifier, recipient_did })
  //   return result.recipient_did
  // }
  //
  // async dataStoreRemoveRecipientDid({
  //   did,
  //   recipient_did,
  // }: IDataStoreRemoveRecipientDid): Promise<string | null> {
  //   const db = await getConnectedDb(this.dbConnection)
  //   const identifier = await db.getRepository(Identifier).findOneBy({ did })
  //   if (!identifier) throw new Error('not_found: Identifier not found')
  //   const result = await db.getRepository(RecipientDid).findOneBy({ recipient_did })
  //   if (!result) return result
  //   await db.getRepository(RecipientDid).remove(result)
  //   return result.recipient_did
  // }
  //
  // async dataStoreListRecipientDids({ did, offset, limit }: IDataStoreListRecipientDids): Promise<string[]> {
  //   const db = await getConnectedDb(this.dbConnection)
  //   const identifier = await db.getRepository(Identifier).findOneBy({ did })
  //   if (!identifier) throw new Error('not_found: Identifier not found')
  //   // TODO: implement pagination
  //   const result = await db
  //     .getRepository(RecipientDid)
  //     .createQueryBuilder('recipient_did')
  //     .where('recipient_did.identifier = :identifier', { identifier: identifier })
  //     .skip(offset)
  //     .take(limit)
  //     .getMany()
  //   return result.map(({ recipient_did }) => recipient_did)
  // }

  async dataStoreGetMessage(args: IDataStoreGetMessageArgs): Promise<IMessage> {
    const messageEntity = await (await getConnectedDb(this.dbConnection)).getRepository(Message).findOne({
      where: { id: args.id },
      relations: ['credentials', 'presentations'],
    })
    if (!messageEntity) throw new Error('not_found: Message not found')

    return createMessage(messageEntity)
  }

  async dataStoreDeleteMessage(args: IDataStoreDeleteMessageArgs): Promise<boolean> {
    const messageEntity = await (await getConnectedDb(this.dbConnection)).getRepository(Message).findOne({
      where: { id: args.id },
      relations: ['credentials', 'presentations'],
    })
    if (!messageEntity) {
      return false
    }

    await (await getConnectedDb(this.dbConnection)).getRepository(Message).remove(messageEntity)

    return true
  }

  async dataStoreDeleteVerifiableCredential(
    args: IDataStoreDeleteVerifiableCredentialArgs,
  ): Promise<boolean> {
    const credentialEntity = await (await getConnectedDb(this.dbConnection))
      .getRepository(Credential)
      .findOneBy({ hash: args.hash })
    if (!credentialEntity) {
      return false
    }

    const claims = await (await getConnectedDb(this.dbConnection))
      .getRepository(Claim)
      .find({ where: { credential: { id: credentialEntity.id } } as any })

    await (await getConnectedDb(this.dbConnection)).getRepository(Claim).remove(claims)

    await (await getConnectedDb(this.dbConnection)).getRepository(Credential).remove(credentialEntity)

    return true
  }

  async dataStoreSaveVerifiableCredential(args: IDataStoreSaveVerifiableCredentialArgs): Promise<string> {
    const verifiableCredential = await (await getConnectedDb(this.dbConnection))
      .getRepository(Credential)
      .save(createCredentialEntity(args.verifiableCredential))
    return verifiableCredential.hash
  }

  async dataStoreGetVerifiableCredential(
    args: IDataStoreGetVerifiableCredentialArgs,
  ): Promise<VerifiableCredential> {
    const credentialEntity = await (await getConnectedDb(this.dbConnection))
      .getRepository(Credential)
      .findOneBy({ hash: args.hash })
    if (!credentialEntity) throw new Error('not_found: Verifiable credential not found')

    return credentialEntity.raw
  }

  async dataStoreSaveVerifiablePresentation(args: IDataStoreSaveVerifiablePresentationArgs): Promise<string> {
    const verifiablePresentation = await (await getConnectedDb(this.dbConnection))
      .getRepository(Presentation)
      .save(createPresentationEntity(args.verifiablePresentation))
    return verifiablePresentation.hash
  }

  async dataStoreGetVerifiablePresentation(
    args: IDataStoreGetVerifiablePresentationArgs,
  ): Promise<VerifiablePresentation> {
    const presentationEntity = await (await getConnectedDb(this.dbConnection))
      .getRepository(Presentation)
      .findOneBy({ hash: args.hash })
    if (!presentationEntity) throw new Error('not_found: Verifiable presentation not found')

    return presentationEntity.raw
  }
}
