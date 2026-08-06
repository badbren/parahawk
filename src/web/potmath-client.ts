/**
 * Browser mirror of src/math/potmath.ts, served at /potmath.js and consumed by
 * the client-side /calc widget. It is a hand-written copy of the SAME four
 * formulas — kept honest by a drift test (src/math/potmath.test.ts) that evals
 * this string and asserts it agrees with the TypeScript module on many inputs.
 * If you change a formula in potmath.ts, change it here too or the test fails.
 */
export const POTMATH_CLIENT_JS = `(function(g){
  var SATS_PER_G_AT_1T = 212500, TWO_POW_32 = 4294967296, SECONDS_PER_DAY = 86400, H_PER_PH = 1e15;
  function roundDepth(W,D){ return D<=0 ? 0 : W/D; }
  function luckPct(W,D){ return W<=0 ? 0 : (100*D)/W; }
  function roundRarity(W,D){ return D<=0 ? 0 : Math.exp(-W/D); }
  function satsPerG(W){ return W<=0 ? 0 : SATS_PER_G_AT_1T/W; }
  function stakeValue(userWorkG,W){ return userWorkG<=0 ? 0 : userWorkG*satsPerG(W); }
  function phdNeededForBlock(D){ return D<=0 ? 0 : (D*1e12*TWO_POW_32)/SECONDS_PER_DAY/H_PER_PH; }
  function expectedWaitDays(D,H){ return H<=0 ? Infinity : phdNeededForBlock(D)/H; }
  function computePotMath(W,D,H){
    return { W:W, D:D, H:H, depth:roundDepth(W,D), luckPct:luckPct(W,D), rarity:roundRarity(W,D),
             satsPerG:satsPerG(W), phdNeeded:phdNeededForBlock(D), expectedDays:expectedWaitDays(D,H) };
  }
  g.PotMath = { SATS_PER_G_AT_1T:SATS_PER_G_AT_1T, roundDepth:roundDepth, luckPct:luckPct, roundRarity:roundRarity,
    satsPerG:satsPerG, stakeValue:stakeValue, phdNeededForBlock:phdNeededForBlock,
    expectedWaitDays:expectedWaitDays, computePotMath:computePotMath };
})(typeof window!=="undefined"?window:this);`;
