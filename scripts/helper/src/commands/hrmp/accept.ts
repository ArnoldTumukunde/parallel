import { createXcm, getApi, getRelayApi, nextNonce, sovereignRelayOf } from '../../utils'
import { Command, CreateCommandParameters, program } from '@caporal/core'
import { Keyring } from '@polkadot/api'

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
      default: 'wss://heiko-rpc.parallel.fi'
    })
    .action(async actionParameters => {
      const {
        logger,
        args: { source, target },
        options: { relayWs, paraWs }
      } = actionParameters
      const relayApi = await getRelayApi(relayWs.toString())
      const encoded = relayApi.tx.hrmp.hrmpAcceptOpenChannel(source.valueOf() as number).toHex()
      const api = await getApi(paraWs.toString())
      const signer = new Keyring({ type: 'sr25519' }).addFromUri(
        `${process.env.PARA_CHAIN_SUDO_KEY || '//Dave'}`
      )
      console.log(
        api.tx.generalCouncil
          .propose(
            2,
            api.tx.polkadotXcm.send(
              {
                V1: {
                  parents: 1,
                  interior: 'Here'
                }
              },
              createXcm(`0x${encoded.slice(6)}`, sovereignRelayOf(target.valueOf() as number))
            ),
            1024
          )
          .toHex()
      )
      // .signAndSend(signer, { nonce: await nextNonce(api, signer) })
      // .then(() => process.exit(0))
      // .catch(err => {
      //   logger.error(err.message)
      //   process.exit(1)
      // })
    })
}
