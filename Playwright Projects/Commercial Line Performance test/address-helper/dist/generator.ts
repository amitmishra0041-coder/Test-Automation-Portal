import { zipToCityState, stateToZips } from '../src/zipData';

function randomFrom(arr: any[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}


export function generateAddress(state: string) {
    const zipList = stateToZips[state];

    if (!zipList) {
        console.log("🟢 createAccountAndQualify received testState:", state);
        throw new Error(`No ZIPs for ${state}`);
    }

    const zip = randomFrom(zipList);
    const location = zipToCityState[zip];

    if (!location) {
        throw new Error(`No mapping for ZIP ${zip}`);
    }

    return {
        address1: `${randomFrom([10,50,100])} Main St`,
        city: location.city,
        state: location.state,
        zip
    };
}