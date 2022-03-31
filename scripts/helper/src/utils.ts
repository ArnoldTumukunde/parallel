import '@polkadot/api-augment'
import { ApiPromise, WsProvider } from '@polkadot/api'
import shell from 'shelljs'
import { blake2AsU8a } from '@polkadot/util-crypto'
import { stringToU8a, bnToU8a, u8aConcat, u8aToHex } from '@polkadot/util'
import { decodeAddress, encodeAddress } from '@polkadot/keyring'
import { KeyringPair } from '@polkadot/keyring/types'
import { Index } from '@polkadot/types/interfaces'
import { Logger } from '@caporal/core'
import { SubmittableExtrinsic } from '@polkadot/api/types'
import { ISubmittableResult } from '@polkadot/types/types'

const EMPTY_U8A_32 = new Uint8Array(32)

export const exec = (cmd: string): shell.ShellString => {
  console.log(`$ ${cmd}`)
  const res = shell.exec(cmd, { silent: true })
  if (res.code !== 0) {
    console.error('Error: Command failed with code', res.code)
    console.log(res)
  }
  return res
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const chainHeight = async (api: ApiPromise): Promise<number> => {
  const {
    block: {
      header: { number: height }
    }
  } = await api.rpc.chain.getBlock()
  return height.toNumber()
}

export const createAddress = (id: string): string =>
  encodeAddress(u8aConcat(stringToU8a(`modl${id}`), EMPTY_U8A_32).subarray(0, 32))

export const sovereignRelayOf = (paraId: number): string =>
  encodeAddress(
    u8aConcat(stringToU8a('para'), bnToU8a(paraId, 32, true), EMPTY_U8A_32).subarray(0, 32)
  )

export const sovereignParaOf = (paraId: number): string =>
  encodeAddress(
    u8aConcat(stringToU8a('sibl'), bnToU8a(paraId, 32, true), EMPTY_U8A_32).subarray(0, 32)
  )

export const subAccountId = (address: string, index: number): string => {
  const seedBytes = stringToU8a('modlpy/utilisuba')
  const whoBytes = decodeAddress(address)
  const indexBytes = bnToU8a(index, 16).reverse()
  const combinedBytes = new Uint8Array(seedBytes.length + whoBytes.length + indexBytes.length)
  combinedBytes.set(seedBytes)
  combinedBytes.set(whoBytes, seedBytes.length)
  combinedBytes.set(indexBytes, seedBytes.length + whoBytes.length)

  const entropy = blake2AsU8a(combinedBytes, 256)
  return encodeAddress(entropy)
}

export const nextNonce = async (api: ApiPromise, signer: KeyringPair): Promise<Index> => {
  return await api.rpc.system.accountNextIndex(signer.address)
}

export const createXcm = (encoded: string, sovereignAccount: string) => {
  return {
    V2: [
      {
        WithdrawAsset: [
          {
            id: {
              Concrete: {
                parents: 0,
                interior: 'Here'
              }
            },
            fun: {
              Fungible: '500000000000'
            }
          }
        ]
      },
      {
        BuyExecution: {
          fees: {
            id: {
              Concrete: {
                parents: 0,
                interior: 'Here'
              }
            },
            fun: {
              Fungible: '500000000000'
            }
          },
          weightLimit: 'Unlimited'
        }
      },
      {
        Transact: {
          originType: 'Native',
          requireWeightAtMost: '1000000000',
          call: {
            encoded
          }
        }
      },
      {
        DepositAsset: {
          assets: {
            Wild: 'All'
          },
          maxAssets: 1,
          beneficiary: {
            parents: 0,
            interior: {
              X1: {
                AccountId32: {
                  network: 'Any',
                  id: u8aToHex(decodeAddress(sovereignAccount))
                }
              }
            }
          }
        }
      }
    ]
  }
}

export const getApi = async (endpoint: string): Promise<ApiPromise> => {
  return ApiPromise.create({
    provider: new WsProvider(endpoint)
  })
}

export const getRelayApi = async (endpoint: string): Promise<ApiPromise> => {
  return ApiPromise.create({
    provider: new WsProvider(endpoint)
  })
}

export const signAndSend = async (
  api: ApiPromise,
  tx: SubmittableExtrinsic<'promise', ISubmittableResult>,
  signer: KeyringPair,
  logger: Logger
): Promise<void> => {
  const nonce = await api.rpc.system.accountNextIndex(signer.address)
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, { nonce }, ({ events, status }) => {
      if (status.isBroadcast) {
        logger.info('tx::broadcasting')
      }
      if (status.isInBlock) {
        logger.info('tx::inBlock')
        events.forEach(({ event }) => {
          if (api.events.system.ExtrinsicFailed.is(event)) {
            const [dispatchError] = event.data
            let errorInfo

            if (dispatchError.isModule) {
              const decoded = api.registry.findMetaError(dispatchError.asModule)

              errorInfo = `${decoded.section}.${decoded.name}`
            } else {
              errorInfo = dispatchError.toString()
            }
            return reject(errorInfo)
          }
        })
      }
      if (status.isFinalized) {
        logger.info(`tx::finalized! block: ${status.asFinalized.toHex()}`)
        return resolve()
      }
      if (status.isFinalityTimeout) {
        return reject('tx::finalityTimeout')
      }
    })
  })
}

export const listenOnSignals = (onSignal: (signal: string) => Promise<void>) => {
  ;['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal =>
    process.on(signal, () => {
      onSignal(signal).finally(() => {
        process.exit(0)
      })
    })
  )
}
