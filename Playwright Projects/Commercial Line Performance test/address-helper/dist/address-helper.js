"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRandomAddress = getRandomAddress;
exports.getRandomAddressByState = getRandomAddressByState;
const zipData_1 = require("./zipData");
function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
async function getRandomAddress(zip) {
    const location = zipData_1.zipToCityState[zip];
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
async function getRandomAddressByState(state) {
    const zipsForState = zipData_1.stateToZips[state];
    if (!zipsForState || zipsForState.length === 0) {
        throw new Error(`No zip codes mapped for state: ${state}`);
    }
    const randomZip = randomFrom(zipsForState);
    return getRandomAddress(randomZip);
}
