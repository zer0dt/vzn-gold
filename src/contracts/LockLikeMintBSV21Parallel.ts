import { BSV20V2, Ordinal } from 'scrypt-ord'
import {
    assert,
    bsv,
    ByteString,
    ContractTransaction,
    hash256,
    int2ByteString,
    len,
    method,
    MethodCallOptions,
    prop,
    PubKeyHash,
    SigHash,
    toByteString,
    Utils,
} from 'scrypt-ts'

// LockLikeMintBSV21Parallel
// - Parallel version of LockLikeMintBSV21.
// - Each mint spends one live minter/token UTXO and creates up to two successor
//   minter UTXOs containing the remaining supply split across branches.
// - This turns the mint lineage from a single chain into a binary tree, reducing
//   contention in the same spirit as CAT20 parallel minting.
export class LockLikeMintBSV21Parallel extends BSV20V2 {
    // Remaining token supply for this branch.
    @prop(true)
    supply: bigint

    @prop()
    readonly sats: bigint

    @prop()
    readonly blocks: bigint

    @prop()
    readonly lim: bigint

    @prop()
    readonly splitThreshold: bigint

    @prop(true)
    lastHeight: bigint

    @prop()
    readonly feeOutput: ByteString

    constructor(
        tick: ByteString,
        max: bigint,
        dec: bigint,
        sats: bigint,
        blocks: bigint,
        lim: bigint,
        splitThreshold: bigint,
        startHeight: bigint,
        feeOutput: ByteString
    ) {
        super(toByteString(''), tick, max, dec)
        this.init(
            tick,
            max,
            dec,
            sats,
            blocks,
            lim,
            splitThreshold,
            startHeight,
            feeOutput
        )
        assert(
            startHeight < 500000000,
            'startHeight must be less than 500000000'
        )

        this.supply = max
        this.sats = sats
        this.blocks = blocks
        this.lim = lim
        this.splitThreshold = splitThreshold
        this.lastHeight = startHeight
        this.feeOutput = feeOutput
    }

    /**
     * Mint tokens by locking sats and posting a MAP like.
     *
     * Output order enforced on-chain:
     * - up to two successor state/minter outputs, each with a share of remaining supply
     * - lockup output
     * - MAP like output
     * - reward transfer output
     * - fixed service fee output
     * - BSV change output
     */
    @method(SigHash.ANYONECANPAY_ALL)
    public mint(
        lockPkh: PubKeyHash,
        rewardPkh: PubKeyHash,
        lockAmount: bigint,
        likedTxid: ByteString,
        appName: ByteString
    ) {
        assert(
            this.ctx.locktime >= this.lastHeight,
            `nLocktime cannot be in the past ${this.lastHeight} ${this.ctx.locktime}}`
        )
        assert(
            this.ctx.locktime + this.blocks < 9437183,
            `lock until height must be less than 9437183, ${this.ctx.locktime} ${this.blocks}}`
        )
        assert(this.ctx.sequence < 0xffffffff, `must use sequence < 0xffffffff`)

        this.lastHeight = this.ctx.locktime
        assert(lockAmount >= this.sats, 'insufficient lock amount for reward')

        const reward = this.calculateReward(lockAmount)
        const remainingSupply = this.supply - reward

        let firstStateOutput = toByteString('')
        let secondStateOutput = toByteString('')
        if (remainingSupply > BigInt(0)) {
            let firstSupply = remainingSupply
            let secondSupply = BigInt(0)
            if (remainingSupply >= this.splitThreshold) {
                firstSupply =
                    LockLikeMintBSV21Parallel.firstBranchSupply(remainingSupply)
                secondSupply = remainingSupply - firstSupply
            }

            this.supply = firstSupply
            firstStateOutput = this.buildStateOutputFT(firstSupply)

            if (secondSupply > BigInt(0)) {
                this.supply = secondSupply
                secondStateOutput = this.buildStateOutputFT(secondSupply)
            }
        }
        if (this.isGenesis()) {
            this.initId()
        }

        const lockUntil = this.ctx.locktime + this.blocks
        const lockOutput = LockLikeMintBSV21Parallel.buildLockupOutput(
            lockPkh,
            lockAmount,
            lockUntil
        )

        const likeOutput = LockLikeMintBSV21Parallel.buildBsocialLikeOutput(
            appName,
            likedTxid
        )

        const rewardOutput = LockLikeMintBSV21Parallel.buildTransferOutput(
            rewardPkh,
            this.id,
            reward
        )

        const outputs: ByteString =
            firstStateOutput +
            secondStateOutput +
            lockOutput +
            likeOutput +
            rewardOutput +
            this.feeOutput +
            this.buildChangeOutput()

        assert(hash256(outputs) === this.ctx.hashOutputs, `invalid outputs hash`)
    }

    @method()
    static firstBranchSupply(remainingSupply: bigint): bigint {
        return (remainingSupply + BigInt(1)) / BigInt(2)
    }

    @method()
    static buildBsocialLikeOutput(
        appName: ByteString,
        likedTxid: ByteString
    ): ByteString {
        const OP_FALSE_OP_RETURN = toByteString('006a')

        const mapPrefix = toByteString(
            '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5',
            true
        )
        const kwSET = toByteString('SET', true)
        const kwApp = toByteString('app', true)
        const kwType = toByteString('type', true)
        const valLike = toByteString('like', true)
        const kwTx = toByteString('tx', true)

        const payload: ByteString =
            OP_FALSE_OP_RETURN +
            LockLikeMintBSV21Parallel.pushData(mapPrefix) +
            LockLikeMintBSV21Parallel.pushData(kwSET) +
            LockLikeMintBSV21Parallel.pushData(kwApp) +
            LockLikeMintBSV21Parallel.pushData(appName) +
            LockLikeMintBSV21Parallel.pushData(kwType) +
            LockLikeMintBSV21Parallel.pushData(valLike) +
            LockLikeMintBSV21Parallel.pushData(kwTx) +
            LockLikeMintBSV21Parallel.pushData(likedTxid)

        return Utils.buildOutput(payload, BigInt(0))
    }

    @method()
    static pushData(data: ByteString): ByteString {
        const dataLen: bigint = len(data)
        return int2ByteString(dataLen, BigInt(1)) + data
    }

    @method()
    calculateReward(lockAmount: bigint): bigint {
        let reward = BigInt(0)
        if (lockAmount >= this.sats) {
            reward = this.lim
        }
        if (this.supply < reward) {
            reward = this.supply
        }
        return reward
    }

    @method()
    static buildLockupOutput(
        lockPkh: PubKeyHash,
        lockAmount: bigint,
        lockUntil: bigint
    ): ByteString {
        const lockScript =
            toByteString(
                '2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c0000'
            ) +
            toByteString('14') +
            lockPkh +
            toByteString('03') +
            int2ByteString(lockUntil, BigInt(3)) +
            toByteString(
                // Must match LockLikeMintBSV21.buildLockupOutput (canonical template).
                '610079040065cd1d9f690079547a75537a537a537a5179537a75527a527a7575615579014161517957795779210ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800206c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce081059795679615679aa0079610079517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e81517a75615779567956795679567961537956795479577995939521414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00517951796151795179970079009f63007952799367007968517a75517a75517a7561527a75517a517951795296a0630079527994527a75517a6853798277527982775379012080517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01205279947f7754537993527993013051797e527e54797e58797e527e53797e52797e57797e0079517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a756100795779ac517a75517a75517a75517a75517a75517a75517a75517a75517a7561517a75517a756169557961007961007982775179517954947f75517958947f77517a75517a756161007901007e81517a7561517a7561040065cd1d9f6955796100796100798277517951790128947f755179012c947f77517a75517a756161007901007e81517a7561517a756105ffffffff009f69557961007961007982775179517954947f75517958947f77517a75517a756161007901007e81517a7561517a75615279a2695679a95179876957795779ac7777777777777777'
            )

        return Utils.buildOutput(lockScript, lockAmount)
    }

    /**
     * Off-chain tx builder for the parallel `mint` method.
     *
     * Mirrors the exact output order enforced by the contract:
     * successor state A, successor state B, lockup, like, reward, fee, change.
     */
    static async buildTxForMint(
        current: LockLikeMintBSV21Parallel,
        options: MethodCallOptions<LockLikeMintBSV21Parallel>,
        lockPkh: PubKeyHash,
        rewardPkh: PubKeyHash,
        lockAmount: bigint,
        likedTxid: ByteString,
        appName: ByteString
    ): Promise<ContractTransaction> {
        const changeAddress =
            options.changeAddress || (await current.signer.getDefaultAddress())
        const reward = current.calculateReward(lockAmount)
        const remainingSupply = current.supply - reward

        let firstSupply = BigInt(0)
        let secondSupply = BigInt(0)
        if (remainingSupply > BigInt(0)) {
            firstSupply = remainingSupply
            if (remainingSupply >= current.splitThreshold) {
                firstSupply =
                    LockLikeMintBSV21Parallel.firstBranchSupply(remainingSupply)
                secondSupply = remainingSupply - firstSupply
            }
        }

        const tokenId = LockLikeMintBSV21Parallel.nextTokenId(current)

        const tx = new bsv.Transaction().addInput(current.buildContractInput())
        tx.inputs[0].sequenceNumber = options.sequence!
        tx.nLockTime = Number(options.lockTime!)

        if (firstSupply > BigInt(0)) {
            const next = current.next()
            next.id = tokenId
            next.lastHeight = BigInt(options.lockTime!)
            next.supply = firstSupply
            LockLikeMintBSV21Parallel.addStateOutput(tx, next)
        }

        if (secondSupply > BigInt(0)) {
            const next = current.next()
            next.id = tokenId
            next.lastHeight = BigInt(options.lockTime!)
            next.supply = secondSupply
            LockLikeMintBSV21Parallel.addStateOutput(tx, next)
        }

        const lockUntil = BigInt(options.lockTime!) + current.blocks
        const lockOutput = LockLikeMintBSV21Parallel.buildLockupOutput(
            lockPkh,
            lockAmount,
            lockUntil
        )
        tx.addOutput(
            bsv.Transaction.Output.fromBufferReader(
                new bsv.encoding.BufferReader(Buffer.from(lockOutput, 'hex'))
            )
        )

        const likeOutput = LockLikeMintBSV21Parallel.buildBsocialLikeOutput(
            appName,
            likedTxid
        )
        tx.addOutput(
            bsv.Transaction.Output.fromBufferReader(
                new bsv.encoding.BufferReader(Buffer.from(likeOutput, 'hex'))
            )
        )

        const rewardOutput = LockLikeMintBSV21Parallel.buildTransferOutput(
            rewardPkh,
            tokenId,
            reward
        )
        tx.addOutput(
            bsv.Transaction.Output.fromBufferReader(
                new bsv.encoding.BufferReader(Buffer.from(rewardOutput, 'hex'))
            )
        )

        tx.addOutput(
            bsv.Transaction.Output.fromBufferReader(
                new bsv.encoding.BufferReader(
                    Buffer.from(current.feeOutput, 'hex')
                )
            )
        )

        tx.change(changeAddress)
        return { tx, atInputIndex: 0, nexts: [] }
    }

    private static nextTokenId(current: LockLikeMintBSV21Parallel): ByteString {
        if (!current.isGenesis()) {
            return current.id
        }

        return (
            Ordinal.txId2str(
                Buffer.from(current.utxo.txId, 'hex').reverse().toString('hex')
            ) +
            toByteString('_', true) +
            Ordinal.int2Str(BigInt(current.utxo.outputIndex))
        )
    }

    private static addStateOutput(
        tx: bsv.Transaction,
        next: LockLikeMintBSV21Parallel
    ) {
        const stateScript =
            BSV20V2.createTransferInsciption(next.id, next.supply) +
            Ordinal.removeInsciption(next.getStateScript())

        const stateOutput = Utils.buildOutput(stateScript, BigInt(1))
        tx.addOutput(
            bsv.Transaction.Output.fromBufferReader(
                new bsv.encoding.BufferReader(Buffer.from(stateOutput, 'hex'))
            )
        )
    }
}
