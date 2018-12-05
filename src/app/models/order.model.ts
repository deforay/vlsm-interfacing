
import { GeneralModel } from './general.model'

export class OrderModel extends GeneralModel {


    addOrderTest(data, success, errorf) {
        console.log(Object.values(data));
        let t = "REPLACE INTO orders (" + Object.keys(data).join(',') + ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)";
        this.exec(t, Object.values(data), success, errorf);
    }

    addOrderTestLog(data, success, errorf) {
        let t = "INSERT INTO orders_log (testedBy,units,results,analysedDateTime,specimenDateTime,acceptedDateTime";
        t += ",machineUsed,testLocation,status,orderID,testType,clientID1) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)";
        this.exec(t, data, success, errorf);
    }

    addResults(data, success, errorf) {
        let t = "UPDATE orders SET testedBy=?,testUnit=?,results=?,analysedDateTime=?,specimenDateTime=?";
        t += ",resultAcceptedDateTime=?,machineUsed=?,testLocation=?,resultStatus=? ";
        t += " WHERE testID=? AND resultStatus<1";
        this.exec(t, data, success, errorf);
    }


}
