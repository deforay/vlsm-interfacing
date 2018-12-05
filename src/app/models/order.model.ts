
import { GeneralModel } from './general.model'

export class OrderModel extends GeneralModel {


    addOrderTest(data, success, errorf) {
        //let t = "REPLACE INTO orders (" + data.names.join(',') + ") VALUES " + data.values.join(',');

        let t = "REPLACE INTO orders ";
        this.exec(t, data, success, errorf);
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
