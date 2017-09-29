subscribe resp_topic as /oneM2M/#
mqtt_message sent: /oneM2M/req/nbiot_cons/onem2m_e65baa96/json 
{ 'm2m:rqp':
   { op: '2',
     to: '/onem2m/nbiot',
     fr: 'nbiot_cons',
     rqi: 12345,
     pc: '' } }
mqtt_message received:
        >topic: /oneM2M/req/nbiot_cons/onem2m_e65baa96/json
        >msg: {"m2m:rqp":{"op":"2","to":"/onem2m/nbiot","fr":"nbiot_cons","rqi":12345,"pc":""}}
mqtt_message received:
        >topic: /oneM2M/resp/nbiot_cons/onem2m_e65baa96/json
        >msg: {"m2m:rsp":{"rsc":2000,"rqi":12345,"pc":{"m2m:ae":{"pi":"Sy2XMSpbb","ty":2,"ct":"20170706T085259","ri":"r1NX_cOiVZ","rn":"nbiot","lt":"20170706T085259","et":"20270706T085259","acpi":["/onem2m/acp_nbiot"],"aei":"nbiot_prod","rr":true}}}}