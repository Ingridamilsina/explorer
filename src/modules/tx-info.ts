import { ethers } from 'ethers';

import { decodeTx } from './contract-info';
import {
  getBlockInfoForBlocks,
  isFromEdenProducer,
  getSlotDelegates,
  getStakerInfo,
  getEdenRPCTxs,
  getBundledTxs,
  getTxRequest,
  getTxReceipt,
} from './getters';
import { getChecksumAddress, weiToGwei, weiToETH, gweiToETH } from './utils';

interface TxInfo {
  viaEdenRPC: boolean;
  pending: boolean;
  gasPrice: number;
  gasLimit: number;
  nonce: number;
  value: number;
  input: string;
  from: string;
  hash: string;
  to: string;
  contractName: string | null;
  bundleIndex: number | null;
  fromEdenProducer: boolean | null;
  blockTxCount: number | null;
  senderStake: number | null;
  gasCost: number | null;
  logs: Array<Object> | null;
  blockNumber: number | null;
  priorityFee: number | null;
  senderRank: number | null;
  timestamp: number | null;
  minerTip: number | null;
  toSlot: number | null;
  gasUsed: number | null;
  baseFee: number | null;
  status: number | null;
  index: number | null;
}

const formatDecodedTxCalldata = (_decoded) => {
  let msgFull = `
  TextSig: ${_decoded.textSig}
  `;
  if (_decoded.args.length > 0) {
    const argsMsg = _decoded.args
      .map((arg) => {
        return `\t* ${arg.key} [${arg.type}]: ${arg.val}`;
      })
      .join('\n');
    msgFull += `Args:\n${argsMsg}`;
  }
  return msgFull;
};

export const getTransactionInfo = async (txHash) => {
  // Get general transaction info
  const [txRequest, txReceipt, edenRPCInfoRes] = await Promise.all([
    getTxRequest(txHash),
    getTxReceipt(txHash),
    getEdenRPCTxs([txHash]),
  ]);
  const edenRPCInfo = edenRPCInfoRes.result[0];
  const mined = txReceipt !== null;
  const viaEdenRPC = edenRPCInfo !== undefined;
  const pendingInEdenMempool = viaEdenRPC && edenRPCInfo.blocknumber === null;
  const pendingInPublicMempool = !mined && txRequest !== null;

  if (!(pendingInPublicMempool || pendingInEdenMempool || mined)) {
    console.error(`Can't find any info for transaction ${txHash}`);
    return null;
  }

  // Get tx info
  const transactionInfo = {
    viaEdenRPC,
    fromEdenProducer: null,
    contractName: null,
    blockTxCount: null,
    senderStake: null,
    blockNumber: null,
    priorityFee: null,
    timestamp: null,
    bundleIndex: null,
    pending: true,
    gasUsed: null,
    gasCost: null,
    baseFee: null,
    toSlot: null,
    status: null,
    minerTip: 0,
    index: null,
    logs: null,
  } as TxInfo;

  if (pendingInEdenMempool) {
    // use just eden rpc source
    transactionInfo.to = getChecksumAddress(
      edenRPCInfo.to || ethers.constants.AddressZero
    );
    transactionInfo.from = getChecksumAddress(edenRPCInfo.from);
    transactionInfo.gasLimit = parseInt(edenRPCInfo.gas, 16);
    transactionInfo.nonce = parseInt(edenRPCInfo.nonce, 10);
    transactionInfo.value = weiToETH(edenRPCInfo.value);
    transactionInfo.input = edenRPCInfo.input;
    transactionInfo.hash = edenRPCInfo.hash;
    if (edenRPCInfo.maxpriorityfeepergas) {
      transactionInfo.priorityFee = weiToGwei(edenRPCInfo.maxpriorityfeepergas);
      // transactionInfo.baseFee =
      //   weiToGwei(edenRPCInfo.gasPrice) - transactionInfo.priorityFee;
    } else {
      transactionInfo.gasPrice = weiToGwei(edenRPCInfo.gasprice);
    }
  } else if (txRequest !== null) {
    // use tx-request object
    transactionInfo.to = getChecksumAddress(
      txRequest.to || ethers.constants.AddressZero
    );
    transactionInfo.blockNumber = parseInt(txRequest.blockNumber, 16);
    transactionInfo.index = parseInt(txRequest.transactionIndex, 16);
    transactionInfo.gasPrice = weiToGwei(txRequest.gasPrice);
    transactionInfo.from = getChecksumAddress(txRequest.from);
    transactionInfo.gasLimit = parseInt(txRequest.gas, 16);
    transactionInfo.nonce = parseInt(txRequest.nonce, 16);
    transactionInfo.value = weiToETH(txRequest.value);
    transactionInfo.input = txRequest.input;
    transactionInfo.hash = txRequest.hash;
    if (txRequest.maxPriorityFeePerGas) {
      transactionInfo.priorityFee = weiToGwei(txRequest.maxPriorityFeePerGas);
      if (transactionInfo.priorityFee !== transactionInfo.gasPrice) {
        transactionInfo.baseFee =
          weiToGwei(txRequest.gasPrice) - transactionInfo.priorityFee;
      }
    }
    if (mined) {
      try {
        const blockNum = parseInt(txRequest.blockNumber, 16);
        const [
          { staked: senderStake, rank: senderRank },
          fromEdenProducer,
          bundledTxsRes,
          slotDelegates,
          [blockInfo],
          decodedTx,
        ] = await Promise.all([
          getStakerInfo(txRequest.from.toLowerCase(), blockNum),
          isFromEdenProducer(blockNum),
          getBundledTxs(blockNum),
          getSlotDelegates(blockNum - 1),
          getBlockInfoForBlocks([blockNum]),
          decodeTx(txRequest.to, txRequest.input),
        ]);
        if (decodedTx.parsedCalldata) {
          transactionInfo.input = formatDecodedTxCalldata(
            decodedTx.parsedCalldata
          );
        }
        transactionInfo.contractName = decodedTx.contractName;
        transactionInfo.fromEdenProducer = fromEdenProducer;
        transactionInfo.senderStake = parseInt(senderStake, 10) / 1e18;
        transactionInfo.senderRank = senderRank;
        transactionInfo.toSlot =
          slotDelegates[txRequest.to.toLowerCase()] ?? null;
        if (bundledTxsRes[0] && txHash in bundledTxsRes[1]) {
          const { minerTip, bundleIndex } = bundledTxsRes[1][txHash];
          transactionInfo.bundleIndex = bundleIndex ?? null;
          transactionInfo.minerTip = (minerTip && weiToETH(minerTip)) ?? 0;
        }
        transactionInfo.timestamp = parseInt(blockInfo.result.timestamp, 16);
        transactionInfo.blockTxCount = blockInfo.result.transactions.length;
        transactionInfo.baseFee = weiToGwei(blockInfo.result.baseFeePerGas);
        transactionInfo.gasUsed = parseInt(txReceipt.gasUsed, 16);
        transactionInfo.status = parseInt(txReceipt.status, 16);
        transactionInfo.logs = txReceipt.logs;
        transactionInfo.gasCost = gweiToETH(
          transactionInfo.gasUsed * transactionInfo.gasPrice
        );
        transactionInfo.pending = false;
      } catch (_) {} // eslint-disable-line no-empty
    }
  }
  return transactionInfo;
};

export type { TxInfo };