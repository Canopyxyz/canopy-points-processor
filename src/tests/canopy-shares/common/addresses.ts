import { Address } from "../../../utils/types.js";

type Store = {
  store: Address;
  owner: Address;
};

type CanopyVaultInfo = {
  vaultAddress: Address;
  vaultShareAddress: Address;
  someValidStores: Store[];
};

type NonCanopyShareFA = {
  faMetadataAddress: Address;
  someValidStores: Store[];
};

// NOTE: we use actual valid addresses on Movement mainnet as the Deposit and Withdraw event handlers make a view call
// and in order for that call to succeed valid data should be used

export const SoloDeployerAddress = "0xbee7f0e5192c31d6fd4c90c83d567230ee23cbc2f10138a89c231e40c05bee13";
export const SatayManagerAddress = "0x5858accdba70476b7026878f84c2d74af6a8f5b5a3f60bc45ddf2b12dc46626d";

export const canopyVaultInfos: CanopyVaultInfo[] = [
  {
    vaultAddress: "0xf8e39a8e9f492f4e0e2b5e79d4a17f0358ca01165372a0bb2642023ca2c21971", // rsETH Echelon vault
    vaultShareAddress: "0x95a1771f3c4569ca57c1e1a55e5b7f985028ba698e7f7b37bc3d582c1cfff6f",
    someValidStores: [
      {
        store: "0x96adbf3e3de38f106b2fe4e419aaa23b18fc55b36728d65598d8f2542f47f830",
        owner: SoloDeployerAddress,
      },
      {
        store: "0x14a3bc60938920d0e2a8836e6f84057ec56be01c9b1e6493b59ddf47798c6eff",
        owner: SatayManagerAddress,
      },
    ],
  },
  {
    vaultAddress: "0x1add335785489b1694db14df964790904058ee71c776589a2d35b948f0c679ec", // solvBTC Echelon vault
    vaultShareAddress: "0x44d42a3b738a8d9a30de1082bd9e461286da0692b53fac8f0be5852407bcc7f",
    someValidStores: [
      {
        store: "0xa01f78a2c48291101ffeba6933525c88475b5f0f10c9acc6eedca35aefc05adc",
        owner: SoloDeployerAddress,
      },
      {
        store: "0x31a0fb007eda1e851d9fbb8f93c6d7f6715fd4820b8c0b838ee8fa2778801a4e",
        owner: SatayManagerAddress,
      },
    ],
  },
];

export const nonCanopyShareFAs: NonCanopyShareFA[] = [
  {
    faMetadataAddress: "0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d", // rsETH FA
    someValidStores: [
      {
        store: "0xae21a837dd1ddffdd7e51b3e9f43a3cabb253da05a25f87d24dbd597c1326827",
        owner: SoloDeployerAddress,
      },
      {
        store: "0xe272db7c26aab2bc688b76b7686d51ec3492c591370e8a72548eedc377347019",
        owner: SatayManagerAddress,
      },
    ],
  },
  {
    faMetadataAddress: "0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d", // solvBTC FA
    someValidStores: [
      {
        store: "0x8a3ab26623f608c08b25493151043f3139d4aa66c81e7b887a04a4c922273c3c",
        owner: SoloDeployerAddress,
      },
      {
        store: "0xc2d75ded7f37f356a515789608ab8f667914d2e98a0923c2127550dd97814eb7",
        owner: SatayManagerAddress,
      },
    ],
  },
];
