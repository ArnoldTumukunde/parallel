import { getApi } from '../utils'
import { Command, CreateCommandParameters, program } from '@caporal/core'
import { BN } from '@polkadot/util'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'
import * as fs from 'fs'
import os from 'os'
import util from 'util'

export default function ({ createCommand }: CreateCommandParameters): Command {
  return createCommand('mint')
    .option('-p, --para-ws [url]', 'the parachain API endpoint', {
      default: 'wss://rpc.parallel.fi'
    })
    .option('-i, --input [csv]', 'the csv file which contains address,amount', {
      default: 'not_signed_users_cDot.csv'
    })
    .option('-o, --output [json]', 'the json file which contains all encoded calls', {
      default: 'encoded-calls.json'
    })
    .option('-a, --asset-id [number]', 'the asset id to mint', {
      validator: program.NUMBER,
      default: 101
    })
    .action(async actionParameters => {
      const {
        options: { paraWs, input, output, assetId }
      } = actionParameters
      const api = await getApi(paraWs.toString())
      const content = await util.promisify(fs.readFile)(input.toString(), 'utf8')
      const records = content
        .split(os.EOL)
        .filter(Boolean)
        .slice(1)
        .map(x => x.replace('\r', '').split(','))
      console.log(records.length)
      const calls = [],
        step = 50
      for (let i = 0; i < records.length; i += step) {
        const encoded = api.tx.utility
          .batchAll(
            records.slice(i, i + step).map(([address, amount]) => {
              const subAddress = encodeAddress(decodeAddress(address, true, 0), 42)
              return api.tx.assets.mint(assetId.valueOf() as number, subAddress, new BN(amount))
            })
          )
          .toHex()
        calls.push(encoded)
      }
      await util.promisify(fs.writeFile)(output.toString(), JSON.stringify(calls, null, 4), 'utf8')
      process.exit(0)
    })
}
