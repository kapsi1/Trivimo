package pl.healthsync.domain

import java.io.StringReader
internal enum class TakeoutActivityKind { STEPS, DISTANCE, TOTAL_CALORIES, ACTIVE_CALORIES }

fun main() {
    val weights = readTakeoutMeasurements(StringReader("timestamp,weight grams,data source\n2026-01-01T06:00:00Z,72500,Example scale\n"), TakeoutKind.WEIGHT)
    check(weights.single().value == 72.5 && weights.single().source == "Example scale")
    val total = mutableListOf<TakeoutActivitySample>()
    val active = mutableListOf<TakeoutActivitySample>()
    readTakeoutActivityCsv(StringReader("timestamp,calories,data source\n2026-01-01T00:00:00Z,0,Example device\n"), TakeoutActivityKind.TOTAL_CALORIES, total::add)
    readTakeoutActivityCsv(StringReader("timestamp,Kilocalories,data source\n2026-01-01T00:00:00Z,1.25,Example device\n"), TakeoutActivityKind.ACTIVE_CALORIES, active::add)
    check(total.single().value == 0.0 && active.single().value == 1.25)
    check(active.single().source == ActivitySourceCategory.UNKNOWN)
    val estimate = TakeoutActivityDayAccumulator(sumDistinctSameMinute = true)
    readTakeoutActivityCsv(StringReader("timestamp,calories,data source\n2026-01-01T00:00:00Z,10,Google Health App\n2026-01-01T00:01:00Z,20,Google Health App\n"), TakeoutActivityKind.TOTAL_CALORIES, estimate::add)
    check(estimate.result().value == 30.0)
    val unknown = TakeoutActivityDayAccumulator()
    unknown.add(active.single())
    check(unknown.result().value == null)
    check(runCatching { readTakeoutMeasurements(StringReader("timestamp,weight grams,data source\n2026-01-01T06:00:00Z,invalid,Example scale\n"), TakeoutKind.WEIGHT) }.isFailure)
    println("Syntetyczna próba parserów: OK")
}
