import {
  createAddress,
  createPaidXcm,
  createUnpaidXcm,
  getApi,
  getRelayApi,
  sovereignRelayOf,
  XCM_FEE
} from '../../utils'
import { Command, CreateCommandParameters, program } from '@caporal/core'
import { PolkadotRuntimeParachainsConfigurationHostConfiguration } from '@polkadot/types/lookup'
import { BN } from '@polkadot/util'
import { blake2AsU8a } from '@polkadot/util-crypto'

const TREASURY_PALLET_ID = 'py/trsry'

export default function ({ createCommand }: CreateCommandParameters): Command {
  return createCommand('accept hrmp channel from specific chain')
    .argument('<source>', 'paraId of source chain', {
      validator: program.NUMBER
    })
    .argument('<target>', 'paraId of target chain', {
      validator: program.NUMBER
    })
    .option('-r, --relay-ws [url]', 'the relaychain API endpoint', {
      default: 'wss://kusama-rpc.parallel.fi'
    })
    .option('-p, --para-ws [url]', 'the parachain API endpoint', {
      default: 'wss://statemine-rpc.polkadot.io'
    })
    .action(async actionParameters => {
      const {
        args: { source, target },
        options: { relayWs, paraWs }
      } = actionParameters
      const relayApi = await getRelayApi(relayWs.toString())
      const api = await getApi(paraWs.toString())
      const treasuryAccount = createAddress(TREASURY_PALLET_ID)
      const statemineAccount = sovereignRelayOf(target.valueOf() as number)
      const accept = relayApi.tx.hrmp.hrmpAcceptOpenChannel(source.valueOf() as number)
      const configuration =
        (await relayApi.query.configuration.activeConfig()) as unknown as PolkadotRuntimeParachainsConfigurationHostConfiguration
      const open = relayApi.tx.hrmp.hrmpInitOpenChannel(
        source.valueOf() as number,
        configuration.hrmpChannelMaxCapacity,
        configuration.hrmpChannelMaxMessageSize
      )
      const encoded = api.tx.polkadotXcm
        .send(
          {
            V1: {
              parents: 1,
              interior: 'Here'
            }
          },
          createPaidXcm(
            `0x${relayApi.tx.utility.batchAll([accept, open]).toHex().slice(6)}`,
            treasuryAccount
          )
        )
        .toHex()

      const data = relayApi.tx.utility
        .batchAll([
          relayApi.tx.balances.forceTransfer(
            treasuryAccount,
            statemineAccount,
            configuration.hrmpSenderDeposit
              .toBn()
              .add(configuration.hrmpRecipientDeposit)
              .add(new BN(XCM_FEE))
              .toString()
          ),
          relayApi.tx.xcmPallet.send(
            {
              V1: {
                parents: 0,
                interior: {
                  X1: {
                    Parachain: target.valueOf() as number
                  }
                }
              }
            },
            createUnpaidXcm(`0x${encoded.slice(8)}`)
          )
        ])
        .method.toHex()

      const hash = blake2AsU8a(data, 256)
      const call = relayApi.tx.utility.batchAll([
        relayApi.tx.democracy.notePreimage(data),
        relayApi.tx.democracy.propose(hash, relayApi.consts.democracy.minimumDeposit)
      ])

      console.log(call.toHex())
    })
}
