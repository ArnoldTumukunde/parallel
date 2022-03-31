import { getApi, gracefullyShutdown, signAndSend, decrypt } from '../utils'
import { Command, CreateCommandParameters, program } from '@caporal/core'
import { BN } from '@polkadot/util'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'
import * as fs from 'fs'
import os from 'os'
import util from 'util'
import Keyring from '@polkadot/keyring'
import { Level } from 'level'

const readFile = util.promisify(fs.readFile)
const BATCH_SIZE = 50

enum TxStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED'
}

export default function ({ createCommand }: CreateCommandParameters): Command {
  return createCommand('asset mint')
    .option('-p, --para-ws [url]', 'the parachain API endpoint', {
      default: 'ws://127.0.0.1:9948'
    })
    .option('-i, --input [csv]', 'the csv file which contains address,amount', {
      default: 'input.csv'
    })
    .option('-d, --db-path [path]', 'the database path', {
      default: 'db'
    })
    .option('-k, --keystore-path [path]', 'the keystore path', {
      default: 'keystore'
    })
    .option('-a, --asset-id [number]', 'the asset id to mint', {
      validator: program.NUMBER,
      default: 100
    })
    .action(async actionParameters => {
      const {
        logger,
        options: { paraWs, input, assetId, dbPath, keystorePath }
      } = actionParameters
      const suri = await decrypt(await readFile(keystorePath.toString(), 'utf8'))
      const api = await getApi(paraWs.toString())
      const keyring = new Keyring({ type: 'sr25519' })
      const signer = keyring.addFromUri(`${suri || process.env.PARA_CHAIN_SUDO_KEY || '//Dave'}`)
      logger.info(`signer: ${signer}`)
      const db = new Level(dbPath.toString(), { valueEncoding: 'json' })
      const inputContent = await readFile(input.toString(), 'utf8')
      const lines = inputContent
        .split(os.EOL)
        .filter(Boolean)
        .slice(1)
        .map(x => x.replace('\r', '').split(','))
      let encoded
      gracefullyShutdown(async (signal: string) => {
        logger.info(`Received ${signal} signal, gracefully shutting down...`)
        let q = false
        while (encoded && !q) {
          try {
            const status = await db.get(encoded)
            q = status === TxStatus.CONFIRMED
          } catch (e) {
            q = e.code === 'LEVEL_NOT_FOUND'
          }
        }
      })
      for (let i = 0; i < lines.length; i += BATCH_SIZE) {
        const chunk = lines.slice(i, i + BATCH_SIZE)
        const calls = chunk.map(([address, amount]) => {
          const subAddress = encodeAddress(decodeAddress(address, false), 42)
          return api.tx.assets.mint(assetId.valueOf() as number, subAddress, new BN(amount))
        })
        const tx = api.tx.utility.batchAll(calls)
        encoded = tx.toHex()
        logger.info(`=====================Line: ${i.toString().padStart(4, '0')}==================`)
        try {
          const status = await db.get(encoded)
          if (status in TxStatus) {
            logger.info(`Found in db, skipped! Status: ${status}`)
            continue
          } else {
            logger.error(`Broken db! Status: ${status}`)
            break
          }
        } catch (e) {
          if (e.code === 'LEVEL_NOT_FOUND') {
            await db.put(encoded, TxStatus.PENDING)
            await signAndSend(api, tx, signer, logger)
            await db.put(encoded, TxStatus.CONFIRMED)
          } else {
            logger.error(`Error happened! code: ${e.code}`)
            break
          }
        }
      }
      process.exit(0)
    })
}
