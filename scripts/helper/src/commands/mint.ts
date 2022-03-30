import { getApi } from '../utils'
import { Command, CreateCommandParameters, program } from '@caporal/core'
import { BN } from '@polkadot/util'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'
import * as fs from 'fs'
import os from 'os'
import util from 'util'
import Keyring from '@polkadot/keyring'

const readFile = util.promisify(fs.readFile)
const writeFile = util.promisify(fs.writeFile)
const BATCH_SIZE = 50

export default function ({ createCommand }: CreateCommandParameters): Command {
  return createCommand('mint')
    .option('-p, --para-ws [url]', 'the parachain API endpoint', {
      default: 'wss://cj-dev-rpc.parallel.fi'
    })
    .option('-i, --input [csv]', 'the csv file which contains address,amount', {
      default: 'input.csv'
    })
    .option('-o, --output [json]', 'the json file which contains all encoded calls', {
      default: 'output.json'
    })
    .option('-a, --asset-id [number]', 'the asset id to mint', {
      validator: program.NUMBER,
      default: 100
    })
    .action(async actionParameters => {
      const {
        options: { paraWs, input, output, assetId }
      } = actionParameters
      const api = await getApi(paraWs.toString())
      const keyring = new Keyring({ type: 'sr25519' })
      const signer = keyring.addFromUri(`${process.env.PARA_CHAIN_SUDO_KEY || '//Dave'}`)
      const inputContent = await readFile(input.toString(), 'utf8')
      const lines = inputContent
        .split(os.EOL)
        .filter(Boolean)
        .slice(1)
        .map(x => x.replace('\r', '').split(','))
      const nonce = await api.rpc.system.accountNextIndex(signer.address)
      const batch = []
      for (let i = 0; i < lines.length; i += BATCH_SIZE) {
        const chunk = lines.slice(i, i + BATCH_SIZE)
        const calls = chunk.map(([address, amount]) => {
          const subAddress = encodeAddress(decodeAddress(address, false), 42)
          return api.tx.assets.mint(assetId.valueOf() as number, subAddress, new BN(amount))
        })
        const tx = api.tx.utility.batchAll(calls)
        batch.push([tx, tx.toHex(), nonce.addn(1)])
      }
      // for (const [tx, , nonce] of batch) {
      //   await tx.signAndSend(signer, { nonce })
      // }
      const outputContent = JSON.stringify(
        batch.map(([, encoded]) => encoded),
        null,
        4
      )
      await writeFile(output.toString(), outputContent, 'utf8')
      process.exit(0)
    })
}
