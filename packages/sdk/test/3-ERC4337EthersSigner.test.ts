import { SampleRecipient, SampleRecipient__factory } from '@erc4337/common/dist/src/types'
import { ethers } from 'hardhat'
import { ClientConfig, ERC4337EthersProvider, newProvider } from '../src'
import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'
import { expect } from 'chai'
import { parseEther } from 'ethers/lib/utils'
import { Wallet } from 'ethers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

const provider = ethers.provider
const signer = provider.getSigner()

describe('ERC4337EthersSigner, Provider', function () {
  let recipient: SampleRecipient
  let aaProvider: ERC4337EthersProvider
  let entryPoint: EntryPoint
  before('init', async () => {
    const deployRecipient = await new SampleRecipient__factory(signer).deploy()
    entryPoint = await new EntryPoint__factory(signer).deploy(1, 1)
    const config: ClientConfig = {
      chainId: await provider.getNetwork().then(net => net.chainId),
      entryPointAddress: entryPoint.address,
      bundlerUrl: ''
    }
    const aasigner = Wallet.createRandom()
    aaProvider = await newProvider(provider, config, aasigner)

    const beneficiary = provider.getSigner().getAddress()
    // for testing: bypass sending through a bundler, and send directly to our entrypoint..
    aaProvider.httpRpcClient.sendUserOpToBundler = async (userOp) => {
      try {
        await entryPoint.handleOps([userOp], beneficiary)
      } catch (e: any) {
        // doesn't report error unless called with callStatic
        await entryPoint.callStatic.handleOps([userOp], beneficiary).catch((e: any) => {
          // eslint-disable-next-line
          const message = e.errorArgs != null ? `${e.errorName}(${e.errorArgs.join(',')})` : e.message
          throw new Error(message)
        })
      }
    }
    recipient = deployRecipient.connect(aaProvider.getSigner())
  })

  it('should fail to send before funding', async () => {
    try {
      await recipient.something('hello', { gasLimit: 1e6 })
      throw new Error('should revert')
    } catch (e: any) {
      expect(e.message).to.eq('FailedOp(0,0x0000000000000000000000000000000000000000,wallet didn\'t pay prefund)')
    }
  })

  it('should use ERC-4337 Signer and Provider to send the UserOperation to the bundler', async function () {
    const walletAddress = await aaProvider.getSigner().getAddress()
    await signer.sendTransaction({
      to: walletAddress,
      value: parseEther('0.1')
    })
    const ret = await recipient.something('hello')
    await expect(ret).to.emit(recipient, 'Sender')
      .withArgs(anyValue, walletAddress, 'hello')
  })

  it('should revert if on-chain userOp execution reverts', async function () {
    // specifying gas, so that estimateGas won't revert..
    const ret = await recipient.reverting({ gasLimit: 10000 })

    try {
      await ret.wait()
      throw new Error('expected to revert')
    } catch (e: any) {
      expect(e.message).to.match(/test revert/)
    }
  })
})
