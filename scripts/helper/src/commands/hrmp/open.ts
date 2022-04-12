import { createPaidXcm, getApi, getRelayApi, sovereignRelayOf } from '../../utils'
import { Command, CreateCommandParameters, program } from '@caporal/core'
import { PolkadotRuntimeParachainsConfigurationHostConfiguration } from '@polkadot/types/lookup'

export default function ({ createCommand }: CreateCommandParameters): Command {
  return createCommand('open hrmp channel to specific chain')
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
      default: 'wss://heiko-rpc.parallel.fi'
    })
    .action(async actionParameters => {
      const {
        args: { source, target },
        options: { relayWs, paraWs }
      } = actionParameters
      const relayApi = await getRelayApi(relayWs.toString())
      const api = await getApi(paraWs.toString())
      const configuration =
        (await relayApi.query.configuration.activeConfig()) as unknown as PolkadotRuntimeParachainsConfigurationHostConfiguration
      const encoded = relayApi.tx.hrmp
        .hrmpInitOpenChannel(
          target.valueOf() as number,
          configuration.hrmpChannelMaxCapacity,
          configuration.hrmpChannelMaxMessageSize
        )
        .toHex()
      console.log(
        api.tx.generalCouncil
          .propose(
            2,
            api.tx.ormlXcm.sendAsSovereign(
              {
                V1: {
                  parents: 1,
                  interior: 'Here'
                }
              },
              createPaidXcm(`0x${encoded.slice(6)}`, sovereignRelayOf(source.valueOf() as number))
            ),
            1024
          )
          .toHex()
      )
    })
}
