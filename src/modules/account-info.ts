import { ethers } from 'ethers';

import {
  getBlockInfoForBlocks,
  getTxCountForAccount,
  filterForEdenBlocks,
  getTxsForAccount,
  getSlotDelegates,
  getLatestStake,
  getEdenRPCTxs,
} from './getters';
import { weiToGwei } from './utils';

interface TxOverview {
  status: 'success' | 'fail';
  blockTxCount: number;
  priorityFee: number;
  viaEdenRPC: boolean;
  timestamp: number;
  isEden: boolean;
  block: number;
  index: number;
  hash: string;
  from: string;
  to: string;
}

interface AccountOverview {
  slotDelegate: number | null;
  edenStaked: number;
  stakerRank: number;
  txCount: number;
  address: string;
  ens?: string;
}

async function getEdenTxsForAccount(_account, _txPerPage, _page) {
  const txsForAccount = await getTxsForAccount(_account, _txPerPage, _page);
  const txHashesForAccount = txsForAccount.map((tx) => tx.hash);
  const blocksForAccount = txsForAccount
    .map((tx) => tx.blockNumber)
    .filter((b, i, a) => a.indexOf(b) === i); // Remove duplicates
  const [edenBlocks, blockInfos, edenRPCTxs] = await Promise.all([
    filterForEdenBlocks(blocksForAccount),
    getBlockInfoForBlocks(blocksForAccount),
    getEdenRPCTxs(txHashesForAccount),
  ]);
  // Filter out txs that were not mined in an Eden block
  const isEdenBlock = Object.fromEntries(
    edenBlocks.blocks.map((b) => [b.number, true])
  );
  const infoForBlock = Object.fromEntries(
    blockInfos.map((r) => [r.id, r.result])
  );
  const edenRPCInfoForTx = Object.fromEntries(
    edenRPCTxs.result.map((tx) => [tx.hash, tx.blocknumber])
  );
  const txsForAccountEnriched = txsForAccount.map((tx) => {
    const blockInfo = infoForBlock[tx.blockNumber];
    tx.blockTxCount = blockInfo.transactions.length;
    tx.baseFee = blockInfo.baseFeePerGas || 0;
    tx.fromEdenProducer = isEdenBlock[tx.blockNumber] ?? false;
    tx.viaEdenRPC = edenRPCInfoForTx[tx.hash] !== undefined;
    return tx;
  });
  return txsForAccountEnriched;
}

export const getAccountInfo = async (
  _account,
  _txPerPage = 1000,
  _page = 1
) => {
  const [
    txsForAccount,
    { staked: edenStaked, rank: stakerRank },
    accountTxCount,
    slotDelegates,
  ] = await Promise.all([
    getEdenTxsForAccount(_account.toLowerCase(), _txPerPage, _page),
    getLatestStake(_account.toLowerCase()),
    getTxCountForAccount(_account),
    getSlotDelegates(),
  ]);
  const accountOverview: AccountOverview = {
    slotDelegate: slotDelegates[_account.toLowerCase()] ?? null,
    stakerRank: stakerRank && parseInt(stakerRank, 10),
    edenStaked: parseInt(edenStaked, 10) / 1e18,
    address: ethers.utils.getAddress(_account),
    txCount: accountTxCount,
  };
  const formatTx = (_tx) => ({
    to: ethers.utils.getAddress(_tx.to || ethers.constants.AddressZero),
    priorityFee: weiToGwei(_tx.gasPrice) - weiToGwei(_tx.baseFee),
    status: _tx.isError === '0' ? 'success' : 'fail',
    index: parseInt(_tx.transactionIndex, 10),
    block: parseInt(_tx.blockNumber, 10),
    nonce: parseInt(_tx.nonce, 10),
    blockTxCount: _tx.blockTxCount,
    isEden: _tx.fromEdenProducer,
    viaEdenRPC: _tx.viaEdenRPC,
    timestamp: _tx.timeStamp,
    from: _tx.from,
    hash: _tx.hash,
  });
  const transactions: Array<TxOverview> = txsForAccount.map(formatTx);
  return { accountOverview, transactions };
};
