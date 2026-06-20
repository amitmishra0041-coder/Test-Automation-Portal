"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAddress = generateAddress;
const zipData_1 = require("./zipData");
function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
const streets = [
    "Main St",
    "Oak Ave",
    "Market St",
    "Washington Blvd",
    "Lincoln Dr",
    "Broad St",
    "Elm St"
];
const numbers = [10, 50, 100, 200, 300, 400, 500, 700, 900];
function generateAddress(state) {
    const zip = randomFrom(zipData_1.stateToZips[state]);
    const location = zipData_1.zipToCityState[zip];
    return {
        address1: `${randomFrom(numbers)} ${randomFrom(streets)}`,
        city: location.city,
        state: location.state,
        zip
    };
}
//# sourceMappingURL=generator.js.map