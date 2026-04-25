"""
DRF serializers replacing the Pydantic BaseModel classes from FastAPI.

Field names, defaults, and validation rules are preserved exactly.
"""

from rest_framework import serializers


class PredictRequestSerializer(serializers.Serializer):
    pump_type = serializers.CharField()
    impeller_moc = serializers.CharField()
    impeller_moc_confirm = serializers.CharField()
    diffuser_moc = serializers.CharField()
    diffuser_moc_confirm = serializers.CharField()
    special_instruction = serializers.CharField(default="NONE", required=False, allow_blank=True)
    head_per_chamber = serializers.FloatField(min_value=0.0001)
    number_of_chambers = serializers.FloatField(min_value=0.0001)
    speed_rpm = serializers.FloatField(min_value=0.0001)
    flow_m3h = serializers.FloatField(min_value=0.0)
    pump_efficiency = serializers.FloatField(min_value=0.0001, max_value=100.0)
    total_head = serializers.FloatField(min_value=0.0)
    pump_power_kw = serializers.FloatField(required=False, allow_null=True, default=None)

    def validate_special_instruction(self, value):
        if value is None or (isinstance(value, str) and value.strip() == ""):
            return "NONE"
        return str(value).strip()


class PredictResponseSerializer(serializers.Serializer):
    full_diameter_mm = serializers.FloatField()
    trimmed_diameter_mm = serializers.FloatField()
    pump_power_used_kw = serializers.FloatField()
    pump_power_was_estimated = serializers.BooleanField()
    message = serializers.CharField(allow_null=True, default=None)


class DatasetMatchRequestSerializer(serializers.Serializer):
    pump_type = serializers.CharField()
    impeller_moc = serializers.CharField()
    diffuser_moc = serializers.CharField()
    special_instruction = serializers.CharField(default="NONE", required=False, allow_blank=True)
    head_per_chamber = serializers.FloatField()
    number_of_chambers = serializers.FloatField()
    speed_rpm = serializers.FloatField()
    flow_m3h = serializers.FloatField()
    pump_efficiency = serializers.FloatField()
    total_head = serializers.FloatField()
    pump_power_kw = serializers.FloatField(required=False, allow_null=True, default=None)
    match_mode = serializers.CharField(default="similarity", required=False)
    min_numeric_match_percent = serializers.FloatField(
        default=90.0, min_value=0.0, max_value=100.0, required=False,
    )

    def validate_special_instruction(self, value):
        if value is None or (isinstance(value, str) and value.strip() == ""):
            return "NONE"
        return str(value).strip()
