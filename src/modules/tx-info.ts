import { ethers } from 'ethers';

import {
  getTxInfoByEdenRPC,
  getBundledTxs,
  getTxRequest,
  getTxReceipt,
} from './getters';
import { getChecksumAddress, weiToGwei, weiToETH } from './utils';

interface TxInfo {
  viaEdenRPC: boolean;
  inBundle: boolean;
  pending: boolean;
  gasPrice: number;
  gasLimit: number;
  nonce: number;
  value: number;
  input: string;
  from: string;
  hash: string;
  to: string;
  logs: Array<Object> | null;
  blockNumber: number | null;
  priorityFee: number | null;
  gasUsed: number | null;
  baseFee: number | null;
  status: number | null;
  index: number | null;
}

export const getTransactionInfo = async (_txHash) => {
  // Get general transaction info
  const [txRequest, txReceipt, edenRPCInfo] = await Promise.all([
    getTxRequest(_txHash),
    getTxReceipt(_txHash),
    getTxInfoByEdenRPC(_txHash),
  ]);

  const mined = txReceipt !== null;
  const viaEdenRPC = edenRPCInfo !== undefined;
  const pendingInEdenMempool = viaEdenRPC && edenRPCInfo.blockNumber === null;
  const pendingInPublicMempool = !mined && txRequest !== null;

  if (!(pendingInPublicMempool || pendingInEdenMempool || mined)) {
    console.log(`Can't find any info for transaction ${_txHash}`);
    return null;
  }

  // Get tx info
  const transactionInfo = {
    viaEdenRPC,
    blockNumber: null,
    priorityFee: null,
    pending: !mined, // Exclude case of tx not existing with above check
    inBundle: false,
    gasUsed: null,
    baseFee: null,
    status: null,
    index: null,
    logs: null,
  } as TxInfo;

  if (pendingInEdenMempool) {
    // use just eden rpc source
    transactionInfo.to = getChecksumAddress(
      edenRPCInfo.to || ethers.constants.AddressZero
    );
    transactionInfo.gasPrice = weiToGwei(edenRPCInfo.gasPrice);
    transactionInfo.from = getChecksumAddress(edenRPCInfo.from);
    transactionInfo.gasLimit = parseInt(edenRPCInfo.gas, 16);
    transactionInfo.value = weiToETH(edenRPCInfo.value);
    transactionInfo.nonce = parseInt(edenRPCInfo.nonce, 10);
    transactionInfo.input = edenRPCInfo.input;
    transactionInfo.hash = edenRPCInfo.hash;
    if (txRequest.maxpriorityfeepergas) {
      transactionInfo.priorityFee = weiToGwei(edenRPCInfo.maxpriorityfeepergas);
      transactionInfo.baseFee =
        weiToGwei(edenRPCInfo.gasPrice) - transactionInfo.priorityFee;
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
      transactionInfo.baseFee =
        weiToGwei(txRequest.gasPrice) - transactionInfo.priorityFee;
    }

    if (mined) {
      // Check if tx was in bundle
      const [success, bundledTxs] = await getBundledTxs(
        parseInt(txRequest.blockNumber, 16)
      );
      if (success) {
        transactionInfo.inBundle = bundledTxs[txRequest.hash] !== undefined;
      }
      // use tx-receipt object
      transactionInfo.gasUsed = parseInt(txReceipt.gasUsed, 16);
      transactionInfo.status = parseInt(txReceipt.status, 16);
      transactionInfo.logs = txReceipt.logs;
    }
  }
  return transactionInfo;
};
