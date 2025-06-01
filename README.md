# Canopy Points System - Sentio Processor

This Sentio processor tracks user positions in Canopy vaults on the Movement network to support a points rewards program. It monitors on-chain events related to canopy vault creation and fungible asset operations (deposits/withdrawals), storing balance data optimized for efficient time-weighted average calculations.

The processor uses a cumulative balance-seconds approach that enables O(log n) computation of average balances between any two arbitrary timestamps, making it ideal for flexible points calculations based on time-weighted holdings.

## Components

- **Vault Processor**: Tracks creation of new Canopy vaults and maintains global vault statistics
- **Fungible Asset Processor**: Monitors deposits and withdrawals of vault shares, maintaining cumulative balance-seconds data with lazy snapshot creation

## Key Features

- **Efficient Average Balance Queries**: Pre-computed cumulative values enable fast calculation of time-weighted average balances
- **Lazy Snapshot System**: Snapshots are created with ~24-hour lifetimes to reduce storage overhead while maintaining query precision
- **Metadata Caching**: Reduces RPC calls by caching fungible store metadata lookups
- **Global Statistics**: Tracks system-wide metrics for monitoring and analytics

## Prerequisites

- `pnpm`: The code is tested with pnpm 8.6.2. Later versions should work too.
- `node`: The code is tested with Node 22.0.0. Later versions should work too.
- `sentio cli`: The code is tested with sentio cli 2.23.0

## Installation

To install dependencies:

```shell
pnpm i
```

To generate schemas found in their respective schema files and types off of ABIs found in the `./abis` folder:

```shell
pnpm gen
```

## Adding an ABI for a New Processor

### Less Preferred Way

To add a new ABI, you'll need to pull the ABI from on chain. The method to do so differs from chain to chain. Once aquired, add the ABI to the `./abis` folder under the proper folder structure for the chain. The ABI will be picked up by the next `pnpm gen` command.

For example on Aptos the ABI for a given module can be fetched as follows:

```shell
# replace it with the network your contract lives on
NETWORK=testnet # could be devnet, testnet or mainnet

# replace it with your contract address
CONTRACT_ADDRESS=0x12345

# replace it with your module name, every .move file except move script has module_address::module_name {}
MODULE_NAME=fungible_asset_launchpad

# save the ABI to a TypeScript file
echo "export const ABI = $(curl https://fullnode.$NETWORK.aptoslabs.com/v1/accounts/$CONTRACT_ADDRESS/module/$MODULE_NAME | sed -n 's/.*"abi":\({.*}\).*}$/\1/p') as const" > abi.ts

# NOTE: you'll have to extract the JSON abi from the abi.ts file
# Since the JSON ABI is an array of the above ABI objects you can stich multiple module ABIs into a single JSON file
# For example ./abis/aptos/ichi-vaults.json combines the ABIs for all the modules published at the address i.e. vault, entry, ichi_token, ...

# Alternatively, you can run the following command to get the complete JSON ABI of all modules at a specified address

curl https://fullnode.$NETWORK.aptoslabs.com/v1/accounts/$CONTRACT_ADDRESS/modules > abi.json

# Or to get the ABI of only a single module in a JSON file:

curl https://fullnode.$NETWORK.aptoslabs.com/v1/accounts/$CONTRACT_ADDRESS/module/$MODULE_NAME > $MODULE_NAME.json

# IMPORTANT: the JSON abi in the ./abis folder should be wrapped in an array i.e. []
# IMPORTANT: for events that do NOT end in "Event" you'll have to set "isEvent": true in the event struct ABI for codegen to treat it as an event struct
# IMPORTANT: if the ABI depends on other module ABIs and you don't load those ABIs as well then if those ABIs are non-essential you can reduce/minimize the core ABI
```

### More Preferred Way

A more convenient way to get the ABI for contracts/modules published under a given address on a given chain would be to use the following command:

```shell
# NOTE: chain_id can be found in the ChainId type from @sentio/chain which is a composite of the enums of the different chains that sentio supports
# such as EthChainId, AptosChainId, SuiChainId, etc
# e.g. AptosChainId.APTOS_TESTNET = 'aptos_testnet'
npx sentio add --name <package_or_contract_name> --chain <chain_id> <contract_publisher_address>
```

## Adding or Updating Schema

To add or update a schema, either add a new `schema.<your-schema-name>.graphql` file or update an existing one. And then run the `pnpm gen` command.

## Running tests

The local testing suite runs the same processors as the sentio indexer.
A local database and store is used to run these tests. Please be sure that the schema is generated before running these tests.

To run tests:

```shell
pnpm test
```

## Uploading to Sentio

If your api key has not already been set for the sentio cli you'll be prompted to set it when uploading. Sentio api keys can be found in the sentio dashboard.

Alternatively, if you want to configure the api key you can do so as follows:

```shell
npx @sentio/cli login --api-key <api-key>
```

The target project to upload to is configured in the `sentio.yaml` in the following format:

```yaml
project: <sentio-account-username>/<sentio-project-name>
```

**IMPORTANT**: given the current implementation a single sentio project can only handle multiple processors on the SAME chain.
This requires that the `CHAIN_ID` environment variable be configured for this sentio project. This can be done under the Project's **Variables** on the Sentio Dashboard. One of the main disadvantages of having multiple processors included in the same sentio project is that if one fails(e.g. due to a bug that throws an error) then the entire project halts; so for greater resilience you could publish processors in isolation of each other, this can be done by commenting out a processor for a given chain in `./src/processor.ts`. In future this sentio indexer project could be improved to allow for multiple chains to be uploaded to the same sentio project by having the graphql entities record the chain ID in their ID; however with the tradeoff being even lower resilience as if any processor across any chain fails then the entire project halts.

Once the `CHAIN_ID` variable has been configured on the dashboard you can then upload the processor to sentio using the following command:

```shell
pnpm upload
```
