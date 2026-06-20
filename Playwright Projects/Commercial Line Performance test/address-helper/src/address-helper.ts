import { zipToCityState, stateToZips } from './zipData';

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function getRandomAddress(zip: string): Promise<Address> {
  const location = zipToCityState[zip];

  if (!location) {
    throw new Error(`No city/state found for zip code: ${zip}`);
  }

  return {
    street: `${Math.floor(Math.random() * 900 + 100)} Main St`,
    city: location.city,
    state: location.state,
    zip
  };
}

export async function getRandomAddressByState(state: string): Promise<Address> {
  const zipsForState = stateToZips[state];

  if (!zipsForState || zipsForState.length === 0) {
    throw new Error(`No zip codes mapped for state: ${state}`);
  }

  const randomZip: string = randomFrom(zipsForState);

  return getRandomAddress(randomZip);
}